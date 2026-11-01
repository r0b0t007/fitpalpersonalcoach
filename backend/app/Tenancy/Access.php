<?php

namespace App\Tenancy;

use App\Coaching\HealthConsent;
use App\Models\ExerciseMedia;
use App\Models\User;

/**
 * Who may touch which client's data — the checks that are not a plain coach_id filter. Every one
 * answers a boolean; the route turns `false` into its Node answer (403 `forbidden` for a member,
 * whether unknown or someone else's, so a coach cannot enumerate the membership).
 */
final class Access
{
    /**
     * api/domain.mjs canCoachMember: a coach may read and program a member who is theirs; an
     * admin may for anyone — the one cross-tenant read. Nobody coaches themselves (that is the
     * ordinary Plan screen), and a disabled member, or a disabled coach, cannot be coached.
     */
    public static function canCoachMember(User $coach, ?User $member): bool
    {
        if ($member === null || $member->id === $coach->id || $member->disabled || $coach->disabled) {
            return false;
        }

        return $coach->isAdmin() || $member->coach_id === $coach->id;
    }

    /**
     * Progress photos (api/server.js GET /api/media/photo): the client themselves, or whoever may
     * coach them — which includes an admin, but through canCoachMember, so not for a disabled
     * member, and not by a disabled admin.
     */
    public static function canSeePhotos(User $viewer, User $owner): bool
    {
        // Anyone else only with the client's consent to share their health data (CHW-360).
        return $viewer->id === $owner->id || (self::canCoachMember($viewer, $owner) && HealthConsent::given($owner));
    }

    /**
     * A coach's demo media (spec §5 — the one deliberate change from Node, which handed every row
     * to every member): the coach who uploaded it, a client of that coach, or an admin.
     */
    public static function canSeeMedia(User $viewer, ExerciseMedia $media): bool
    {
        return $viewer->isAdmin() || $media->coach_id === $viewer->id || ($viewer->coach_id !== null && $viewer->coach_id === $media->coach_id);
    }
}
