<?php

namespace App\Audit;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The audit log: who signed in, who was refused, what an admin changed. Read by the owner's
 * Business › Audit screen through GET /api/admin/audit; event names are labelled for people in
 * frontend/src/lib/audit.js (api/scripts/check-audit-labels.mjs keeps the two in step), and `msg`
 * carries reason codes, never sentences.
 *
 * Writing never throws: a log that cannot be written must not break signing in.
 */
final class Audit
{
    /** Retention runs about once every this many writes (Node compacted at 1.25 × AUDIT_MAX). */
    private const PRUNE_EVERY = 100;

    /**
     * @param  array{ok?: bool, user?: ?User, uid?: ?string, name?: ?string, target?: ?User, msg?: ?string}  $f
     */
    public static function record(Request $request, string $ev, array $f = []): void
    {
        if (! config('fitpal.audit.enabled')) {
            return;
        }
        try {
            $user = $f['user'] ?? null;
            $target = $f['target'] ?? null;
            $id = DB::table('audit_events')->insertGetId([
                'ts' => (int) floor(microtime(true) * 1000),
                'ev' => $ev,
                'ok' => ($f['ok'] ?? true) !== false,
                'uid' => $user?->id ?? ($f['uid'] ?? null),
                'name' => self::cut($user?->name ?? ($f['name'] ?? null), 40),
                'tgt' => $target?->id,
                'tname' => self::cut($target?->name, 40),
                'msg' => self::cut($f['msg'] ?? null, 120),
                'ip' => ClientIp::for($request, (string) config('fitpal.audit.ip')),
            ]);
            if ($id % self::PRUNE_EVERY === 0) {
                self::prune();
            }
        } catch (Throwable $e) {
            Log::error('audit write failed', ['ev' => $ev, 'error' => $e->getMessage()]);
        }
    }

    /** Retention is a cap, not an archive: age first (AUDIT_DAYS), then the newest AUDIT_MAX. */
    public static function prune(): void
    {
        $days = (int) config('fitpal.audit.days');
        if ($days > 0) {
            DB::table('audit_events')->where('ts', '<', self::cutoff($days))->delete();
        }
        $floor = self::floorId();
        if ($floor !== null) {
            DB::table('audit_events')->where('id', '<', $floor)->delete();
        }
    }

    /** The oldest id still inside AUDIT_MAX, or null when there is no count cap or no overflow. */
    public static function floorId(): ?int
    {
        $max = (int) config('fitpal.audit.max');
        if ($max <= 0) {
            return null;
        }
        $id = DB::table('audit_events')->orderByDesc('id')->skip($max - 1)->value('id');

        return $id === null ? null : (int) $id;
    }

    public static function cutoff(int $days): int
    {
        return (int) floor(microtime(true) * 1000) - $days * 86_400_000;
    }

    private static function cut(?string $s, int $n): ?string
    {
        return $s === null || $s === '' ? null : mb_substr($s, 0, $n);
    }
}
