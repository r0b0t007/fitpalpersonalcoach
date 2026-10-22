<?php

namespace App\Http\Middleware;

use App\Domain\Entitlement;
use App\Models\User;
use App\Support\Json;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The coach's writes that a lapsed licence stops (spec §6): sending a program, saving one to the
 * library, uploading a demo (whole or in chunks) and minting an invite. Everything else stays
 * open — reads, withdrawing an offer, deleting a program, releasing a client — so a read-only
 * coach can still see and tidy what they have. Clients are never refused here, and with billing
 * off (Entitlement `unlicensed`) nothing is.
 *
 * Inside RequireCoach, which has answered 401/403 and set the CoachContext.
 */
final class RequireWriter
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var User|null $user */
        $user = $request->user('api');
        if ($user === null) {
            return Json::error(401, 'not signed in');
        }
        if (! Entitlement::for($user)->canWrite) {
            return self::refusal();
        }

        return $next($request);
    }

    /** Also sent by a write that judges the licence again under its lock (InviteController::coachCreate). */
    public static function refusal(): JsonResponse
    {
        return Json::error(402, 'your plan is read-only until billing is sorted out — see Account › Plan & billing');
    }
}
