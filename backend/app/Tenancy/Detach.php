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
 * It is also the only way a coach's rows are let go of: the coach_id foreign keys restrict
 * deletion, so a coach account is detached, never deleted with its tenant rows still pointing at
 * it. Call it inside the caller's transaction, with the coach's row locked.
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
