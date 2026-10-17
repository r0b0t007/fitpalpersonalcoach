<?php

namespace App\Http\Controllers;

use App\Models\UserState;
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

    public function store(Request $request): JsonResponse
    {
        $raw = $request->getContent();
        if (strlen($raw) > self::MAX_BYTES) {
            return Json::error(413, Say::f('your training data is over the {0} MB limit for one sync, so this device could not save to the server. Delete some old workouts, or export a backup and start a fresh profile.', 16), [], ['Connection' => 'close']);
        }
        $body = json_decode($raw);
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
            ['state' => json_encode($state, Json::FLAGS), 'ts' => $ts],
        );

        return Json::ok(['ok' => true, 'ts' => $ts]);
    }
}
