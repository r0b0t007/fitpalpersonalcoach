<?php

namespace App\Http\Controllers;

use App\Models\Presence;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
        if (! Js::truthy(Input::raw($request, 'active'))) {
            Presence::drop($user->id);

            return Json::ok(['ok' => true]);
        }
        $now = Js::nowMs();
        // Node's object, field for field: `+x || 0` for the counters, `+startedAt || Date.now()`.
        $live = [
            'name' => Js::slice(Input::jsString($request, 'name'), 60),
            'exIdx' => self::num(Input::raw($request, 'exIdx'), 0),
            'exTotal' => self::num(Input::raw($request, 'exTotal'), 0),
            'setsDone' => self::num(Input::raw($request, 'setsDone'), 0),
            'setsTotal' => self::num(Input::raw($request, 'setsTotal'), 0),
            'startedAt' => self::num(Input::raw($request, 'startedAt'), $now),
            'updatedAt' => $now,
        ];
        Presence::query()->upsert([['user_id' => $user->id, 'payload' => Js::stringify($live), 'updated_at' => $now]], ['user_id'], ['payload', 'updated_at']);

        return Json::ok(['ok' => true]);
    }

    /**
     * `+value || fallback`, as the number JSON then carries: a whole number as one, and the
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

        return floor($n) === $n && abs($n) <= 9007199254740991 ? (int) $n : $n;
    }
}
