<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Billing\CreemEvent;
use App\Models\BillingEvent;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/billing/webhook — Creem telling us what happened to a subscription (spec §6; Laravel
 * only). No session: the HMAC is the credential. Creem signs the raw body with HMAC-SHA256 and the
 * webhook secret, hex, in `creem-signature` (docs.creem.io/code/webhooks); anything else is a 401
 * before the body is even parsed. Not CSRF-exempt: Creem sends no Origin, so CsrfOrigin passes it,
 * and a browser page forging the call is refused there first.
 *
 * Creem retries anything but a 200 (30 s, 5 min, 30 min, 6 h) and may deliver one event twice, so:
 * the event id is recorded in the same transaction that applies it — a duplicate is answered
 * `{duplicate: true}` and changes nothing, and a failure rolls both back for the retry to redo.
 * Every answer to a signed event is a 200 except a crash: an orphan, an event we do not use and a
 * stale one are recorded and acknowledged, since retrying them would change nothing.
 *
 * These answers are read by Creem, not the app; their two sentences are in the packs only because
 * check-error-strings holds every literal to that.
 */
final class CreemWebhookController
{
    public function handle(Request $request): JsonResponse
    {
        $secret = (string) config('fitpal.creem.webhook_secret');
        if ($secret === '') {
            return Json::error(404, 'billing is not set up on this server');
        }
        $raw = $request->getContent();
        $signature = $request->headers->get('creem-signature');
        if (! is_string($signature) || ! hash_equals(hash_hmac('sha256', $raw, $secret), strtolower(trim($signature)))) {
            return Json::error(401, 'invalid signature');
        }
        $event = json_decode($raw, true);
        if (! is_array($event) || ! is_string($event['id'] ?? null) || $event['id'] === '' || strlen($event['id']) > 128
            || ! is_string($event['eventType'] ?? null) || ! is_array($event['object'] ?? null) || ! is_numeric($event['created_at'] ?? null)) {
            return Json::error(400, 'not a Creem event');
        }

        $applied = DB::transaction(function () use ($event): ?CreemEvent {
            // The id first: of two deliveries of one event, the second waits on this row and then
            // finds it taken.
            if (BillingEvent::query()->insertOrIgnore(['id' => $event['id'], 'at' => now()]) === 0) {
                return null;
            }
            $reducer = new CreemEvent($event);
            $reducer->apply();

            return $reducer;
        }, 3);
        if ($applied === null) {
            return Json::ok(['ok' => true, 'duplicate' => true]);
        }
        // After the commit, as every audit is: the prune an audit write may trigger holds no lock here.
        foreach ($applied->audits as [$ev, $coach, $msg]) {
            self::record($request, $ev, ['user' => $coach, 'msg' => $msg]);
        }

        return Json::ok(['ok' => true] + ($applied->stale ? ['stale' => true] : []));
    }

    /**
     * Each event written out by name: check-audit-labels finds them by their literal, and an event
     * the reducer names that is not here fails loudly rather than reaching the log unlabelled.
     */
    private static function record(Request $request, string $ev, array $f): void
    {
        match ($ev) {
            'billing.event' => Audit::record($request, 'billing.event', $f),
            'billing.stale' => Audit::record($request, 'billing.stale', $f),
            'billing.ignored' => Audit::record($request, 'billing.ignored', $f),
            'billing.orphan' => Audit::record($request, 'billing.orphan', ['ok' => false] + $f),
            'billing.conflict' => Audit::record($request, 'billing.conflict', ['ok' => false] + $f),
            'billing.unsold' => Audit::record($request, 'billing.unsold', ['ok' => false] + $f),
            'billing.refund' => Audit::record($request, 'billing.refund', $f),
            'billing.dispute' => Audit::record($request, 'billing.dispute', ['ok' => false] + $f),
        };
    }
}
