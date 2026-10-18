<?php

namespace App\Auth;

use App\Models\Invite;
use App\Models\User;

/**
 * The two questions every use of an invite code asks (api/domain.mjs redeemableInvite and
 * coachBinding): can this code still be redeemed, and whose roster does redeeming it put someone
 * on. Registration (both halves), the invite landing screen and redeeming from an existing account
 * all ask through here, so none of them can drift into letting a spent code back in.
 */
final class InviteGate
{
    /**
     * The invite a code names, if it is neither used nor revoked. Typed, pasted with a trailing
     * space or lower-cased by somebody's URL bar, it is the same code. Says nothing about SHAPE:
     * BOOTSTRAP_CODE and hand-written codes in old databases must keep working.
     *
     * $lock takes the row for the rest of the caller's transaction, so two redemptions of one code
     * cannot both pass this check (Node had no await between the check and the write).
     */
    public static function redeemable(?string $code, bool $lock = false): ?Invite
    {
        $c = self::normalise($code);
        if ($c === '') {
            return null;
        }
        $query = Invite::acrossCoaches()->whereKey($c); // across coaches: a code is a global key
        $invite = ($lock ? $query->lockForUpdate() : $query)->first();

        return $invite && $invite->used_by === null && ! $invite->revoked ? $invite : null;
    }

    /**
     * The coach redeeming this invite binds someone to, or null. Read from the invite's explicit
     * coach_id, never inferred from who minted it — admins count as coaches, so inferring would
     * make every general admin code silently assign that admin. And judged NOW, not at mint time:
     * a code can sit unread for a fortnight, and a coach disabled or demoted in between must not
     * keep acquiring clients. Null is not a refusal of a signup: the member registers unassigned.
     */
    public static function coachBinding(Invite $invite): ?User
    {
        if ($invite->coach_id === null) {
            return null;
        }
        $coach = User::query()->find($invite->coach_id);

        return $coach && $coach->isCoach() && ! $coach->disabled ? $coach : null;
    }

    public static function normalise(?string $code): string
    {
        return strtoupper(trim((string) $code));
    }
}
