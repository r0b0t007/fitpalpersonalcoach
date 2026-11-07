<?php

namespace App\Http\Controllers;

use App\Coaching\Referrals;
use App\Models\CoachPage;
use App\Models\User;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/coach/referrals → {handle, signedUp, activated} (CHW-350): the Account
 * card. The handle is the coach's page's, which their link carries, or null with no page yet.
 */
final class CoachReferralController
{
    public function show(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');

        return Json::ok(['handle' => CoachPage::query()->find($coach->id)?->handle] + Referrals::summary($coach));
    }
}
