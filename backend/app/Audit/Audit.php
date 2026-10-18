<?php

namespace App\Audit;

use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
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
 * the read path applies it, so nothing past retention is ever served. prune() deletes the rest,
 * at the same two moments the Node API compacted: hourly (routes/console.php), so an idle instance
 * honours AUDIT_DAYS too, and amortised on write, so a flood of failed sign-ins cannot grow the
 * table far past AUDIT_MAX between two hourly runs. Like Node, none of it happens while the log is
 * off: turning it off freezes the trail, it does not erase it.
 */
final class Audit
{
    /** Column widths, shared by record() and the import so the two cannot truncate differently. */
    private const WIDTHS = ['uid' => 16, 'name' => 40, 'tgt' => 16, 'tname' => 40, 'msg' => 120, 'ip' => 45, 'ev' => 64];

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
            DB::table('audit_events')->insert(self::row([
                'ts' => self::now(),
                'ev' => $ev,
                'ok' => $f['ok'] ?? true,
                'uid' => $user?->id ?? ($f['uid'] ?? null),
                'name' => $user?->name ?? ($f['name'] ?? null),
                'tgt' => $target?->id,
                'tname' => $target?->name,
                'msg' => $f['msg'] ?? null,
                'ip' => ClientIp::for($request, (string) config('fitpal.audit.ip')),
            ]));
            self::pruneIfOverflowing();
        } catch (Throwable $e) {
            Log::error('audit write failed', ['ev' => $ev, 'error' => $e->getMessage()]);
        }
    }

    /**
     * One record as stored: widths applied, '' as null, ok a boolean that only `false` turns off.
     * Used for live events and for imported audit.log lines alike.
     */
    public static function row(array $r): array
    {
        $out = ['ts' => (int) ($r['ts'] ?? 0), 'ok' => ($r['ok'] ?? true) !== false];
        if (isset($r['id'])) {
            $out['id'] = (int) $r['id'];
        }
        foreach (self::WIDTHS as $k => $n) {
            $v = isset($r[$k]) && $r[$k] !== '' ? mb_substr((string) $r[$k], 0, $n) : null;
            $out[$k] = $v;
        }

        return $out;
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
        if (! config('fitpal.audit.enabled')) {
            return 0;
        }
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

    /**
     * Node compacted once the log passed 1.25 × AUDIT_MAX. Counting the table on every write would
     * cost a query per sign-in, so a shared counter (the cache, not the ids: an auto_increment step
     * other than 1 would skip a modulo forever) checks every quarter of AUDIT_MAX writes.
     */
    private static function pruneIfOverflowing(): void
    {
        $max = (int) config('fitpal.audit.max');
        if ($max <= 0) {
            return;
        }
        $every = max(1, intdiv($max, 4));
        if (Cache::increment('audit:writes') % $every !== 0) {
            return;
        }
        if (DB::table('audit_events')->count() > $max * 1.25) {
            self::prune();
        }
    }
}
