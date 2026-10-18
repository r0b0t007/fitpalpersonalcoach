<?php

namespace App\Auth;

/**
 * The invite a sign-up code names, if it can still be used (api/domain.mjs redeemableInvite).
 *
 * Invite codes — minted by coaches, binding a client to a coach — arrive with R2's invites table.
 * Until then no code is an invite, so an INVITE_ONLY instance opens only to the bootstrap code.
 * The call sites (register options and verify) are already where they will stay.
 */
final class InviteGate
{
    public static function redeemable(?string $code): ?object
    {
        return null;
    }
}
