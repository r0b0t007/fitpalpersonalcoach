<?php

namespace App\Auth;

use App\Models\User;
use App\Support\Js;
use RuntimeException;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * The session token the Node API issued, kept byte for byte.
 *
 * `uid:expiryMs:sv` followed by `.` and the base64url (no padding) HMAC-SHA256 of that payload,
 * keyed with the 64-hex text of the old DATA_DIR/secret file (SESSION_SECRET). The same string is
 * the cookie for browsers and the Bearer token the paired mobile app stored for 90 days, so
 * keeping the format is what lets every signed-in device survive the cutover. `sv` is the user's
 * session version: "sign out everywhere" bumps it and every older token dies.
 */
final class SessionToken
{
    public static function cookieName(): string
    {
        return self::secure() ? '__Host-gymsid' : 'gymsid';
    }

    public static function secure(): bool
    {
        return str_starts_with((string) config('fitpal.origin'), 'https://');
    }

    /** The Node API generated its secret on first boot; this one must be given, or nothing signs. */
    public const MIN_SECRET_LENGTH = 32;

    public static function make(User $user): string
    {
        if (self::secret() === null) {
            throw new RuntimeException('SESSION_SECRET is unset or shorter than '.self::MIN_SECRET_LENGTH.' characters; refusing to sign a session');
        }
        $expiry = Js::nowMs() + (int) config('fitpal.session_days') * 86400000;
        $payload = $user->id.':'.$expiry.':'.(int) ($user->sv ?? 0);

        return $payload.'.'.self::sign($payload);
    }

    /** @return array{uid: string, exp: int, sv: int}|null */
    public static function parse(?string $token): ?array
    {
        // Fail closed: with no secret every token would verify against the empty key.
        if ($token === null || $token === '' || self::secret() === null) {
            return null;
        }
        $dot = strrpos($token, '.');
        if ($dot === false) {
            return null;
        }
        $payload = substr($token, 0, $dot);
        $mac = substr($token, $dot + 1);
        $expected = self::sign($payload);
        if (strlen($mac) !== strlen($expected) || ! hash_equals($expected, $mac)) {
            return null;
        }
        $parts = explode(':', $payload);
        if (count($parts) < 2 || $parts[0] === '' || ! ctype_digit($parts[1])) {
            return null;
        }
        $sv = $parts[2] ?? '0';
        if ($sv === '') {
            $sv = '0';
        }
        if (! ctype_digit($sv)) {
            return null;
        }

        return ['uid' => $parts[0], 'exp' => (int) $parts[1], 'sv' => (int) $sv];
    }

    /** The user a token stands for, or null: bad signature, expired, unknown, disabled, or signed out everywhere. */
    public static function user(?string $token): ?User
    {
        $parsed = self::parse($token);
        if ($parsed === null || $parsed['exp'] < Js::nowMs()) {
            return null;
        }
        $user = User::query()->find($parsed['uid']);
        if ($user === null || $user->disabled || (int) ($user->sv ?? 0) !== $parsed['sv']) {
            return null;
        }

        return $user;
    }

    /** The Set-Cookie headers that sign a browser in: the token, and on https the clearing of the old plain name. */
    public static function cookies(User $user): array
    {
        $cookies = [self::cookie(self::cookieName(), self::make($user), (int) config('fitpal.session_days') * 86400)];
        if (self::secure()) {
            $cookies[] = self::cookie('gymsid', '', 0);
        }

        return $cookies;
    }

    /** The Set-Cookie headers that sign a browser out. */
    public static function clearCookies(): array
    {
        $cookies = [self::cookie(self::cookieName(), '', 0)];
        if (self::secure()) {
            $cookies[] = self::cookie('gymsid', '', 0);
        }

        return $cookies;
    }

    private static function cookie(string $name, string $value, int $maxAge): Cookie
    {
        // Raw: the token must reach the server unchanged. No Domain: a __Host- cookie forbids one.
        return new Cookie($name, $value, $maxAge > 0 ? time() + $maxAge : 1, '/', null, self::secure(), true, true, Cookie::SAMESITE_LAX);
    }

    private static function sign(string $payload): string
    {
        return rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, (string) self::secret(), true)), '+/', '-_'), '=');
    }

    /** Whether sessions can be signed at all; fitpal:check-config asks this rather than re-deriving it. */
    public static function configured(): bool
    {
        return self::secret() !== null;
    }

    private static function secret(): ?string
    {
        $secret = (string) config('fitpal.session_secret');

        return strlen($secret) >= self::MIN_SECRET_LENGTH ? $secret : null;
    }
}
