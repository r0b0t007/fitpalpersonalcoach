<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Auth\DeleteAccount;
use App\Auth\SessionToken;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/account/delete — a client deletes their own account, and every record of it
 * (CHW-363, DeleteAccount). Behind RequireFreshAuth: a session left signed in on a shared phone
 * cannot do it, only one that proved the account just now, by passkey or emailed code.
 */
final class AccountDeleteController
{
    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user('api');
        // A coach's account holds other people's coaching: theirs is closed by the owner, on request.
        if ($user->isCoach()) {
            return Json::error(403, 'a coach account is closed on request — write to us');
        }
        DeleteAccount::run($user);
        // Who, by id and name, in the security log, which retention prunes (AUDIT_DAYS).
        Audit::record($request, 'account.delete', ['uid' => $user->id, 'name' => $user->name]);

        return Json::ok(['ok' => true], cookies: SessionToken::clearCookies());
    }
}
