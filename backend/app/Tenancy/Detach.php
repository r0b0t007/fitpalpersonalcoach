<?php

namespace App\Tenancy;

use App\Models\Assignment;
use App\Models\Invite;
use App\Models\User;

/**
 * api/server.js detachCoach: everything that stops being true when someone can no longer coach —
 * their roster, their unanswered offers, their open invite codes. Losing the role and being
 * disabled both mean exactly this, so both run the one function and neither remembers half of it.
 *
 * It is not a step towards deleting the coach. Their invites, assignments, programs and media keep
 * their coach_id — the record of who issued and sent what — and those foreign keys restrict
 * deletion, so a coach account is detached and kept, never deleted. (users.coach_id alone is
 * nullOnDelete; this clears it by hand anyway, because the account stays.)
 *
 * Call it inside the caller's transaction with the coach's row locked. Everything that attaches to
 * a coach takes that lock first and judges the coach on the locked row — a send
 * (AssignmentController::assign), a mint (InviteController::coachCreate), a redemption or a signup
 * (InviteGate) — so none of them can land half-way through a detach.
 *
 * Node's classes kept their coachId on purpose (disabling is often temporary); the timetable is
 * not ported, so there is nothing of it here.
 */
final class Detach
{
    public static function coach(User $coach): void
    {
        // Their members are left with no coach rather than pointing at a non-coach: re-granting
        // the role later must not hand back a roster nobody reviewed.
        User::clientsOf($coach)->update(['coach_id' => null]);
        Assignment::expireAllFrom($coach->id);
        // A code minted by a role that can be taken away dies with it: the registration gate only
        // asks whether a code is unused and unrevoked, so a coach let go on Monday would otherwise
        // still hand out working signups on Tuesday.
        Invite::revokeOpenOf($coach->id, 'coach detached');
    }
}
