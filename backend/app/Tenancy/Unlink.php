<?php

namespace App\Tenancy;

use App\Models\Assignment;
use App\Models\CoachNote;
use App\Models\JoinRequest;
use App\Models\User;

/**
 * Detach's counterpart for one member: everything that stops being true when a member's link to a
 * coach ends — released by the coach, unassigned or moved by an admin. That coach's unanswered
 * offers lapse, and what the member told them when they asked to join (injuries included, CHW-334)
 * is forgotten. Every path that ends a link calls this, so none can remember half of it.
 *
 * Call it inside the caller's transaction, with the member's row locked, after coach_id has changed.
 */
final class Unlink
{
    public static function member(User $member, ?string $coachId): void
    {
        if ($coachId === null) {
            return;
        }
        Assignment::expirePending($member->id, $coachId);
        // Consent to share health data was given to that coach (CHW-360): the next one asks again.
        $member->forceFill(['health_consent_at' => null])->save();
        JoinRequest::forgetMember($coachId, $member);
        // And what that coach wrote them (CHW-340): a new coach does not read the last one's notes.
        CoachNote::forgetPair($coachId, $member);
    }
}
