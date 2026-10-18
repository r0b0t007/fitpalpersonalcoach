<?php

namespace App\Auth;

/**
 * The bootstrap code: how the first account gets into an INVITE_ONLY instance, and becomes its
 * admin — so the operator never has to find their uid and set ADMIN_UIDS by hand (api/domain.mjs
 * bootstrapMatches).
 *
 * It only works while there are no accounts at all, so it is inert from the first sign-up on.
 * Too short a secret is ignored rather than trusted: a guessable code on an empty instance would
 * hand out the admin account.
 */
final class Bootstrap
{
    public const MIN_LENGTH = 16;

    public static function matches(?string $code, int $userCount, ?string $secret = null): bool
    {
        $want = strtoupper(trim((string) ($secret ?? config('fitpal.bootstrap_code'))));
        // Characters, not bytes: nine accented letters are 18 bytes but still a 9-character secret.
        if (mb_strlen($want) < self::MIN_LENGTH || $userCount !== 0) {
            return false;
        }

        return hash_equals($want, strtoupper(trim((string) $code)));
    }

    /** What is wrong with the configuration, as the Node API warned at boot. */
    public static function warnings(): array
    {
        $code = (string) config('fitpal.bootstrap_code');
        if ($code === '') {
            return [];
        }
        $out = [];
        if (mb_strlen($code) < self::MIN_LENGTH) {
            $out[] = 'BOOTSTRAP_CODE is under '.self::MIN_LENGTH.' characters and will be ignored — use a long random string.';
        }
        // Not Node's wording, which said the first account would NOT be made admin. It is, if the
        // code is supplied (an invite-style link carries it) — only the form never asks for it.
        if (! config('fitpal.invite_only')) {
            $out[] = 'BOOTSTRAP_CODE is set but INVITE_ONLY is off — the sign-up form will not ask for the code, yet whoever supplies it on the first sign-up still becomes admin. Set INVITE_ONLY=1, or clear BOOTSTRAP_CODE.';
        }

        return $out;
    }
}
