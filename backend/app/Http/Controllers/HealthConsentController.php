<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\HealthConsent;
use App\Models\User;
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
        return $this->answer($request->user('api'));
    }

    public function give(Request $request): JsonResponse
    {
        // A yes, and nothing that merely looks like one: this is the Art. 9(2)(a) record.
        if (Input::raw($request, 'agree') !== true) {
            throw new ClientSafe(400, 'please agree to share this with your coach');
        }
        // On the row as it is now, locked: a client released while the sheet was open has no coach
        // to agree to, and a consent recorded then would pass to whichever coach came next.
        $user = DB::transaction(function () use ($request): User {
            $me = User::query()->whereKey($request->user('api')->id)->lockForUpdate()->firstOrFail();
            if (! HealthConsent::required($me)) {
                throw new ClientSafe(409, 'you have no coach to share this with');
            }
            $me->forceFill(['health_consent_at' => Js::nowMs()])->save();

            return $me;
        });
        Audit::record($request, 'me.health.consent', ['user' => $user]);

        return $this->answer($user);
    }

    public function withdraw(Request $request): JsonResponse
    {
        // The row locked as a photo upload locks it, so one in flight either lands first and is
        // erased here, or finds the consent gone and files nothing.
        [$user, $files] = DB::transaction(function () use ($request): array {
            $me = User::query()->whereKey($request->user('api')->id)->lockForUpdate()->firstOrFail();
            $me->forceFill(['health_consent_at' => null])->save();

            return [$me, HealthConsent::erase($me)];
        });
        foreach ($files as $file) {
            @unlink($file);
        }
        Audit::record($request, 'me.health.withdraw', ['user' => $user]);

        return $this->answer($user);
    }

    private function answer(User $user): JsonResponse
    {
        return Json::ok(['required' => HealthConsent::required($user), 'consentAt' => $user->health_consent_at]);
    }
}
