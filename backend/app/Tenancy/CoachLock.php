<?php

namespace App\Tenancy;

use App\Models\User;

/**
 * The one lock order for anything that attaches to a coach or lets go of one: the COACH's row
 * first, in a statement of its own, then whatever else the transaction needs (members, invites,
 * offers). Tenancy\Detach runs with the coach locked and then touches the roster, the offers and
 * the codes; a path that took a member or an invite first could hold what Detach needs next while
 * waiting for the coach — a deadlock.
 *
 * Every attach path calls this: a send (AssignmentController::assign), a mint
 * (InviteController::coachCreate), the program library, a redemption or a signup
 * (InviteGate::redeemable), and the admin's assign-coach. The row it returns is read under the
 * lock, so the caller judges the coach as they are now — not as RequireCoach saw them before
 * the wait.
 */
final class CoachLock
{
    public static function take(string $coachId): ?User
    {
        return User::query()->whereKey($coachId)->lockForUpdate()->first();
    }
}
