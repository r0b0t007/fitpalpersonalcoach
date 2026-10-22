<?php

namespace App\Http\Controllers;

use App\Billing\Creem;
use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Models\Licence;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Tenancy\CoachLock;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * A coach paying for their plan (spec §6, R4; Laravel only): a Creem checkout for a plan, what
 * their licence says now, and the link to Creem's customer portal, where the plan is changed or
 * canceled in v1. Behind RequireCoach and NOT RequireWriter — a lapsed coach must be able to pay.
 *
 * The licence itself is written by the webhook (CHW-270); a checkout only leaves a `pending` row
 * pointing at the session, which the webhook finds by metadata.userId or request_id.
 */
final class BillingController
{
    /** A pending checkout this young is handed out again rather than a second one made. */
    public const REUSE_MINUTES = 30;

    /** Seconds a checkout waits for the coach's previous one (a double tap) — past Creem::TIMEOUT. */
    public static int $lockWait = 20;

    /**
     * POST /api/billing/checkout {plan, period} → {url}. Decided under the coach's lock, the call
     * to Creem made without it (a slow provider must not hold the coach's writes), the pending row
     * written under it again — judged afresh, since a webhook may have licensed them meanwhile.
     *
     * One at a time per coach (a cache lock around all of it, not the row lock): a double tap waits
     * for the first and is then handed the same checkout, instead of opening a second payable one.
     * A checkout for another plan, period or product is a new pending row; the earlier one keeps
     * its session ids, so the webhook can still match it should that session be paid after all.
     */
    public function checkout(Request $request): JsonResponse
    {
        try {
            return Cache::lock('billing:checkout:'.$request->user('api')->id, 60)->block(self::$lockWait, fn () => $this->checkoutOnce($request));
        } catch (LockTimeoutException) {
            throw new ClientSafe(502, 'the payment service did not answer — try again in a moment');
        }
    }

    private function checkoutOnce(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
        $plan = Input::raw($request, 'plan');
        $period = Input::raw($request, 'period');
        self::refuseUnbilled($coach);
        $product = is_string($plan) && is_string($period) ? Plans::product($plan, $period) : null;
        if ($product === null) {
            throw new ClientSafe(400, 'no such plan');
        }

        $reuse = DB::transaction(function () use ($coach, $plan, $period, $product): ?string {
            $me = self::lockedCoach($coach);
            $licence = Entitlement::licenceOf($me, 'update');
            self::refuseHeld($licence);
            // The product too: a price change, or a move from the test store to the live one, makes
            // the old session the wrong thing to pay.
            $fresh = $licence?->source === 'creem' && $licence->status === 'pending'
                && $licence->plan === $plan && $licence->period === $period && $licence->creem_product_id === $product
                && $licence->checkout_url !== null && $licence->checkout_at?->gt(now()->subMinutes(self::REUSE_MINUTES));

            return $fresh ? $licence->checkout_url : null;
        });
        if ($reuse !== null) {
            return Json::ok(['url' => $reuse]);
        }

        $requestId = 'req_'.Js::token(18);
        $body = [
            'product_id' => $product,
            'request_id' => $requestId,
            'success_url' => config('fitpal.origin').'/',
            'metadata' => ['userId' => $coach->id, 'plan' => $plan, 'period' => $period],
        ];
        if (is_string($coach->email) && $coach->email !== '') {
            $body['customer'] = ['email' => $coach->email];
        }
        $session = Creem::checkout($body);

        DB::transaction(function () use ($coach, $plan, $period, $product, $requestId, $session): void {
            $me = self::lockedCoach($coach);
            self::refuseHeld(Entitlement::licenceOf($me, 'update'));
            // Always a new row: whatever was there (an earlier session, an ended subscription, a
            // revoked grant) stays as history with its own ids.
            $licence = (new Licence)->forceFill(['id' => Licence::newId(), 'user_id' => $coach->id, 'source' => 'creem', 'status' => 'pending']);
            $licence->forceFill([
                'plan' => $plan, 'period' => $period, 'creem_product_id' => $product,
                'checkout_id' => $session['id'], 'request_id' => $requestId,
                'checkout_url' => $session['url'], 'checkout_at' => now(),
            ])->save();
            User::query()->whereKey($coach->id)->update(['licence_id' => $licence->id]);
        });

        return Json::ok(['url' => $session['url']]);
    }

    /** GET /api/billing/me → {entitlement, licence, plans} — the Plan & billing section and the banners. */
    public function me(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
        $licence = Entitlement::licenceOf($coach);

        return Json::ok([
            'entitlement' => Entitlement::for($coach)->toArray(),
            'licence' => $licence !== null ? self::publicLicence($licence) : null,
            'plans' => Plans::offered(),
            // Whether "Manage billing" has somewhere to go (portal()).
            'portal' => self::customerOf($coach) !== null,
        ]);
    }

    /** POST /api/billing/portal → {url}: Creem's page for this coach's subscription. */
    public function portal(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
        self::refuseUnbilled($coach);
        $customer = self::customerOf($coach);
        if ($customer === null) {
            throw new ClientSafe(404, 'there is no billing account to manage yet — choose a plan first');
        }

        return Json::ok(['url' => Creem::portal($customer)]);
    }

    /**
     * The coach's Creem customer: the newest of their Creem rows that has one — not only the
     * licence in force, which after a checkout started and abandoned is a pending row with none,
     * while their invoices and an ended subscription are still in the portal.
     */
    private static function customerOf(User $coach): ?string
    {
        $id = Licence::query()->where('user_id', $coach->id)->where('source', 'creem')
            ->whereNotNull('creem_customer_id')->where('creem_customer_id', '!=', '')
            ->orderByDesc('created_at')->orderByDesc('id')->value('creem_customer_id');

        return is_string($id) ? $id : null;
    }

    /** The coach's row under CoachLock: judged as it is now, not as the request began. */
    private static function lockedCoach(User $coach): User
    {
        return CoachLock::take($coach->id) ?? throw new ClientSafe(401, 'not signed in');
    }

    /** Admins are never billed; an instance without Creem bills nobody. */
    private static function refuseUnbilled(User $coach): void
    {
        if ($coach->isAdmin()) {
            throw new ClientSafe(400, 'an admin needs no plan');
        }
        if (! Plans::billingOn()) {
            throw new ClientSafe(404, 'billing is not set up on this server');
        }
    }

    /**
     * A coach who has a plan does not buy a second one: a licence that writes (a grant, a trial, a
     * paid or canceled-but-paid subscription), or a Creem subscription that can still bill
     * (paused, unpaid — the card is updated in the portal, not by subscribing again). Judged on
     * the row the caller holds locked; admins and an instance without billing never get here.
     */
    private static function refuseHeld(?Licence $licence): void
    {
        if ($licence !== null && ($licence->canStillBill() || Entitlement::writable($licence))) {
            throw new ClientSafe(409, 'you already have a plan — see Account › Plan & billing');
        }
    }

    /** What the app may read of a licence: no Creem ids, no checkout URL (the coach is sent there, not shown it). */
    private static function publicLicence(Licence $l): array
    {
        $iso = fn ($at) => $at !== null ? Js::iso($at) : null;

        return [
            'status' => $l->status, 'plan' => $l->plan, 'period' => $l->period, 'source' => $l->source,
            'trialEndsAt' => $iso($l->trial_ends_at), 'periodEnd' => $iso($l->period_end),
            'cancelAt' => $iso($l->cancel_at), 'canceledAt' => $iso($l->canceled_at),
            'checkoutAt' => $iso($l->checkout_at),
        ];
    }
}
