<?php

namespace App\Audit;

use App\Models\User;
use Illuminate\Database\Query\Builder;
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
 *
 * Retention (AUDIT_DAYS, then the newest AUDIT_MAX of what is left) is defined once, in kept():
 * the read path applies it, so nothing past retention is ever served, and prune() — scheduled
 * hourly in routes/console.php, as the Node API compacted hourly — deletes the rest, off the
 * request path and on an idle instance too.
 */
final class Audit
{
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
            DB::table('audit_events')->insert([
                'ts' => self::now(),
                'ev' => $ev,
                'ok' => ($f['ok'] ?? true) !== false,
                'uid' => $user?->id ?? ($f['uid'] ?? null),
                'name' => self::cut($user?->name ?? ($f['name'] ?? null), 40),
                'tgt' => $target?->id,
                'tname' => self::cut($target?->name, 40),
                'msg' => self::cut($f['msg'] ?? null, 120),
                'ip' => ClientIp::for($request, (string) config('fitpal.audit.ip')),
            ]);
        } catch (Throwable $e) {
            Log::error('audit write failed', ['ev' => $ev, 'error' => $e->getMessage()]);
        }
    }

    /** Restricts a query on audit_events to the rows retention keeps. */
    public static function kept(Builder $query): Builder
    {
        $days = (int) config('fitpal.audit.days');
        if ($days > 0) {
            $query->where('ts', '>=', self::cutoff($days));
        }
        if (($floor = self::floorId()) !== null) {
            $query->where('id', '>=', $floor);
        }

        return $query;
    }

    /** Deletes everything kept() excludes. Scheduled hourly; also safe to run by hand. */
    public static function prune(): int
    {
        $days = (int) config('fitpal.audit.days');
        $deleted = $days > 0 ? DB::table('audit_events')->where('ts', '<', self::cutoff($days))->delete() : 0;
        if (($floor = self::floorId()) !== null) {
            $deleted += DB::table('audit_events')->where('id', '<', $floor)->delete();
        }

        return $deleted;
    }

    /**
     * The oldest id inside AUDIT_MAX, counted among the rows AUDIT_DAYS keeps — age first, then
     * count, as Node's auditKeep. Null when there is no count cap or nothing overflows it.
     */
    public static function floorId(): ?int
    {
        $max = (int) config('fitpal.audit.max');
        if ($max <= 0) {
            return null;
        }
        $days = (int) config('fitpal.audit.days');
        $id = DB::table('audit_events')
            ->when($days > 0, fn ($q) => $q->where('ts', '>=', self::cutoff($days)))
            ->orderByDesc('id')->skip($max - 1)->value('id');

        return $id === null ? null : (int) $id;
    }

    public static function cutoff(int $days): int
    {
        return self::now() - $days * 86_400_000;
    }

    public static function now(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    private static function cut(?string $s, int $n): ?string
    {
        return $s === null || $s === '' ? null : mb_substr($s, 0, $n);
    }
}
