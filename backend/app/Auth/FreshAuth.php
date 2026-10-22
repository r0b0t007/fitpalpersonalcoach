<?php

namespace App\Auth;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * "Signed in just now", for the two writes that would outlive a stolen session: changing the
 * sign-in address and adding a passkey (spec §4a). A session alone — a shared laptop left signed
 * in, a paired phone — must not be enough to point the account's recovery at another inbox or
 * plant a passkey that survives `logout/all`.
 *
 * A session counts as fresh for MINUTES after a real proof of the account: a passkey sign-in, an
 * email-link sign-in (whoever opened it holds the inbox), or the sign-up itself. Pairing a phone
 * is not one — it needs only a session, so it would launder an old one into a fresh one. Kept
 * server-side by the token's hash, so the token's format (shared with the Node API) is unchanged.
 */
final class FreshAuth
{
    public const MINUTES = 15;

    public static function mark(string $token): void
    {
        Cache::put(self::key($token), true, now()->addMinutes(self::MINUTES));
    }

    public static function check(Request $request): bool
    {
        $token = TokenGuard::token($request);

        return $token !== null && Cache::has(self::key($token));
    }

    private static function key(string $token): string
    {
        return 'fresh-auth:'.hash('sha256', $token);
    }
}
