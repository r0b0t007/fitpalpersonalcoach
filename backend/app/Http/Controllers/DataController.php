<?php

namespace App\Http\Controllers;

use App\Models\UserState;
use App\Support\Input;
use App\Support\Json;
use App\Support\Say;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The client's whole training state, one blob per account, replaced on every sync. The server
 * never reads inside it to answer these two routes and never re-shapes it: the bytes the app
 * sent are the bytes it gets back, so `{}` stays `{}` and floats keep their digits.
 */
final class DataController
{
    public const MAX_BYTES = 16 * 1024 * 1024;

    public function show(Request $request): Response
    {
        $row = UserState::query()->find($request->user()->id);
        // Assembled by hand rather than decoded and re-encoded: see the class comment.
        $body = '{"state":'.($row?->state ?? 'null').'}';

        return response($body, 200, ['Content-Type' => 'application/json', 'Cache-Control' => 'no-store']);
    }

    /**
     * The refusal for a body over the limit. Also what bootstrap/app.php answers when PHP's own
     * post_max_size refuses the body before this controller runs — the app must get the same
     * sentence either way, not 'server error'.
     */
    public static function tooLarge(): JsonResponse
    {
        return Json::error(413, Say::f('your training data is over the {0} MB limit for one sync, so this device could not save to the server. Delete some old workouts, or export a backup and start a fresh profile.', 16), [], ['Connection' => 'close']);
    }

    public function store(Request $request): JsonResponse
    {
        $raw = $request->getContent();
        if (strlen($raw) > self::MAX_BYTES) {
            return self::tooLarge();
        }
        // Node's readBody: text that is not JSON is `bad json`, not a missing state.
        $body = Input::parse($raw);
        if (! is_object($body) || ! isset($body->state) || ! (is_object($body->state) || is_array($body->state))) {
            return Json::error(400, 'state required');
        }
        $state = $body->state;
        if (is_object($state)) {
            // An in-progress workout is this device's business; it is never synced.
            unset($state->active);
        }
        $ts = is_object($state) && isset($state->_ts) && is_numeric($state->_ts) ? (int) $state->_ts : null;

        UserState::query()->updateOrCreate(
            ['user_id' => $request->user()->id],
            // Encoded as deep as it was parsed: json_encode's default 512 would 500 on a state Node took.
            ['state' => json_encode($state, Json::FLAGS, 100_000), 'ts' => $ts] + UserState::derived($state),
        );

        return Json::ok(['ok' => true, 'ts' => $ts]);
    }
}
