<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\HealthConsent;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/me/health-consent, POST /api/me/health-consent {agree: true}, POST
 * /api/me/health-consent/withdraw (CHW-360): the signed-in client's consent to their coach seeing
 * the health data they log. Withdrawing deletes that data (App\Coaching\HealthConsent::erase).
 */
final class HealthConsentController
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user('api');

        return Json::ok(['required' => HealthConsent::required($user), 'consentAt' => $user->health_consent_at]);
    }

    public function give(Request $request): JsonResponse
    {
        // A yes, and nothing that merely looks like one: this is the Art. 9(2)(a) record.
        if (Input::raw($request, 'agree') !== true) {
            throw new ClientSafe(400, 'please agree to share this with your coach');
        }
        $user = $request->user('api');
        $user->forceFill(['health_consent_at' => Js::nowMs()])->save();
        Audit::record($request, 'me.health.consent', ['user' => $user]);

        return $this->show($request);
    }

    public function withdraw(Request $request): JsonResponse
    {
        $user = $request->user('api');
        DB::transaction(function () use ($user): void {
            $user->forceFill(['health_consent_at' => null])->save();
            HealthConsent::erase($user);
        });
        Audit::record($request, 'me.health.withdraw', ['user' => $user]);

        return $this->show($request);
    }
}
