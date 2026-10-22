<?php

namespace App\Http\Controllers;

use App\Models\Presence;
use App\Models\User;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The live-workout heartbeat (api/server.js POST /api/activity): the app pings every 20 s while a
 * workout is on screen, and `{active: false}` — also as a sendBeacon when the tab closes — takes
 * the account off "training now". Read back as `live` by the coach's roster and the admin list.
 */
final class ActivityController
{
    public function store(Request $request): JsonResponse
    {
        $user = $request->user('api');
        $active = Js::truthy(Input::raw($request, 'active'));
        $now = Js::nowMs();
        // Node's object, field for field: `+x || 0` for the counters, `+startedAt || Date.now()`.
        $live = $active ? [
            'name' => Js::slice(Input::jsString($request, 'name'), 60),
            'exIdx' => self::num(Input::raw($request, 'exIdx'), 0),
            'exTotal' => self::num(Input::raw($request, 'exTotal'), 0),
            'setsDone' => self::num(Input::raw($request, 'setsDone'), 0),
            'setsTotal' => self::num(Input::raw($request, 'setsTotal'), 0),
            'startedAt' => self::num(Input::raw($request, 'startedAt'), $now),
            'updatedAt' => $now,
        ] : null;
        DB::transaction(function () use ($user, $live, $now): void {
            // The account's row, locked, as a disable locks it: a heartbeat that passed the guard
            // just before the account was disabled does not put it back on "training now".
            $me = User::query()->whereKey($user->id)->lockForUpdate()->first();
            if (! $me || $me->disabled) {
                return;
            }
            if ($live === null) {
                // Left: a marker, not nothing, so a heartbeat already in flight cannot undo it.
                Presence::query()->upsert([['user_id' => $user->id, 'payload' => null, 'updated_at' => $now]], ['user_id'], ['payload', 'updated_at']);

                return;
            }
            $left = Presence::query()->whereKey($user->id)->whereNull('payload')->where('updated_at', '>=', $now - Presence::LEFT_HOLD_MS)->exists();
            if (! $left) {
                Presence::query()->upsert([['user_id' => $user->id, 'payload' => Js::stringify($live), 'updated_at' => $now]], ['user_id'], ['payload', 'updated_at']);
            }
        });

        return Json::ok(['ok' => true]);
    }

    /**
     * `+value || fallback`, as the number JSON then carries: a whole number as one (PHP writes a
     * float as 1.0e+19 where JS writes the digits; an int it writes as JS does), and the
     * infinities as null (JSON.stringify writes them so).
     */
    private static function num(mixed $value, int $fallback): int|float|null
    {
        $n = Js::toNumber($value);
        if (is_nan($n) || $n == 0) {
            return $fallback;
        }
        if (is_infinite($n)) {
            return null;
        }

        return floor($n) === $n && abs($n) < 9.2233720368547758E18 ? (int) $n : $n;
    }
}
