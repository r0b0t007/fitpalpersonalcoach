<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\Terms;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET/POST /api/coach/terms (CHW-357): whether this coach has accepted the current coach terms,
 * and accepting them — for a coach who signed up before there were any, or before this version.
 * Not behind RequireWriter: a lapsed plan must not stop a coach agreeing to how their clients'
 * data is handled.
 */
final class CoachTermsController
{
    public function show(Request $request): JsonResponse
    {
        $coach = $request->user('api');

        return Json::ok(['version' => Terms::VERSION, 'accepted' => Terms::accepted($coach), 'acceptedAt' => $coach->terms_at]);
    }

    public function accept(Request $request): JsonResponse
    {
        // The version the coach read, sent back: an app open on an older text accepts nothing.
        if (Input::jsString($request, 'version') !== Terms::VERSION) {
            throw new ClientSafe(409, 'these terms have changed — read them again');
        }
        $coach = $request->user('api');
        $coach->forceFill(['terms_version' => Terms::VERSION, 'terms_at' => Js::nowMs()])->save();
        Audit::record($request, 'coach.terms.accept', ['user' => $coach, 'msg' => Terms::VERSION]);

        return $this->show($request);
    }
}
