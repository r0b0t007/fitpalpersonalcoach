<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The owner's activity log (Business › Audit), as the Node API served it: newest first, paged by
 * id, filtered by category prefix or by failures. Rows outside retention are never shown even if
 * the hourly prune has not run yet (Audit::kept), as Node applied auditKeep on read.
 */
final class AuditController
{
    public function index(Request $request): JsonResponse
    {
        // Query values are strings in Node (searchParams.get). `?cat[]=x` is a different key there,
        // so get('cat') is null: an array here counts as absent, never as a conversion warning.
        $q = fn (string $k): string => is_string($v = $request->query($k)) ? $v : '';
        $limit = max(1, min(200, (int) $q('limit') ?: 100));
        $before = (int) $q('before');
        $cat = $q('cat');

        $rows = Audit::kept(DB::table('audit_events'));
        if ($cat === 'fail') {
            $rows->where('ok', false);
        } elseif ($cat !== '') {
            // Node matched ev.startsWith(cat + '.'). Event names are dotted lowercase words, so a
            // category that is not one matches nothing — and needs no LIKE escaping, which SQLite
            // and MariaDB spell differently.
            preg_match('/^[a-z0-9]+(\.[a-z0-9]+)*$/', $cat)
                ? $rows->where('ev', 'like', $cat.'.%')
                : $rows->whereRaw('1 = 0');
        }

        $total = (clone $rows)->count();
        $page = $rows->when($before > 0, fn ($r) => $r->where('id', '<', $before))
            ->orderByDesc('id')->limit($limit)->get()
            ->map(fn (object $r) => self::event($r))->all();

        return Json::ok([
            'events' => $page,
            'total' => $total,
            'nextBefore' => count($page) === $limit ? end($page)['id'] : null,
            'enabled' => (bool) config('fitpal.audit.enabled'),
            'ip_mode' => (string) config('fitpal.audit.ip'),
            'retention' => ['max' => (int) config('fitpal.audit.max'), 'days' => (int) config('fitpal.audit.days')],
            'now' => Audit::now(),
        ]);
    }

    public function clear(Request $request): JsonResponse
    {
        // DELETE, not TRUNCATE: the id sequence carries on, so a wiped log leaves a visible gap
        // once the next event is written (persistent AUTO_INCREMENT: InnoDB on MariaDB ≥ 10.2.4,
        // MySQL ≥ 8; SQLite AUTOINCREMENT).
        DB::table('audit_events')->delete();
        Audit::record($request, 'admin.audit.clear', ['user' => $request->user()]);

        return Json::ok(['ok' => true]);
    }

    /** One record in Node's shape: optional fields are absent, not null. */
    private static function event(object $r): array
    {
        $e = ['id' => (int) $r->id, 'ts' => (int) $r->ts, 'ev' => $r->ev, 'ok' => (bool) $r->ok];
        foreach (['uid', 'name', 'tgt', 'tname', 'msg', 'ip'] as $k) {
            if ($r->{$k} !== null && $r->{$k} !== '') {
                $e[$k] = $r->{$k};
            }
        }

        return $e;
    }
}
