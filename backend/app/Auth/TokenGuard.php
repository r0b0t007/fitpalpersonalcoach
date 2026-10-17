<?php

namespace App\Auth;

use App\Models\User;
use Illuminate\Http\Request;

/**
 * Resolves the caller from the session token. Cookie first — `__Host-gymsid`, then the plain
 * `gymsid` a browser may still hold from http — then the Bearer header the paired app sends.
 * Two cookies of one name with DIFFERENT values are not guessed at: they count as no cookie and
 * the Bearer header decides, while a single cookie that is present but invalid shadows a Bearer.
 * Both as the Node API's readSession behaved.
 */
final class TokenGuard
{
    public static function resolve(Request $request): ?User
    {
        $token = self::cookieToken($request, SessionToken::cookieName()) ?? self::cookieToken($request, 'gymsid');
        // No cookie, or two of one name that disagree (never guessed at): the Bearer, if any.
        if ($token === null || $token === false) {
            $auth = (string) $request->headers->get('Authorization');
            if (str_starts_with($auth, 'Bearer ')) {
                $token = trim(substr($auth, 7));
            }
        }

        return $token ? SessionToken::user($token) : null;
    }

    /** The cookie's value, null when absent, false when it appears twice with different values. */
    private static function cookieToken(Request $request, string $name): string|false|null
    {
        $header = (string) $request->headers->get('Cookie');
        if ($header === '') {
            $v = $request->cookies->get($name);

            return $v === null ? null : (string) $v;
        }
        $values = [];
        foreach (explode(';', $header) as $pair) {
            $pair = trim($pair);
            if ($pair === '' || ! str_contains($pair, '=')) {
                continue;
            }
            [$k, $v] = explode('=', $pair, 2);
            if (trim($k) === $name) {
                $values[] = $v;
            }
        }
        if ($values === []) {
            return null;
        }
        if (count(array_unique($values)) > 1) {
            return false;
        }

        return $values[0];
    }
}
