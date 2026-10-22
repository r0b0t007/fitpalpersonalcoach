<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Every JSON response of the API goes through here, so the three things the app relies on hold
 * everywhere: no-store caching, unescaped Unicode and slashes (the Node API used
 * JSON.stringify, and error strings with em dashes are translation keys), and the error envelope.
 */
final class Json
{
    public const FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

    /**
     * For a refusal sent before an upload's body has been read: the connection goes, so the client
     * stops sending (Node's `shut`). Without it a 90 MB body keeps arriving at a server that has
     * already answered.
     */
    public const CLOSE = ['Connection' => 'close'];

    /** @param list<Cookie> $cookies */
    public static function ok(array $body, int $status = 200, array $headers = [], array $cookies = []): JsonResponse
    {
        return self::respond($body, $status, $headers, $cookies);
    }

    public static function error(int $status, string $error, array $extra = [], array $headers = []): JsonResponse
    {
        return self::respond(Say::envelope($error, $extra), $status, $headers, []);
    }

    /**
     * The sentence for a refusal that no route worded itself (abort(), a throttle, maintenance,
     * validation): always one of the catalogue's, so the app can translate it, never the
     * framework's own English. Each is also sent as a literal elsewhere, so
     * scripts/check-error-strings.mjs holds them to the locale packs.
     */
    public static function refusal(int $status): string
    {
        return match (true) {
            $status === 401 => 'not signed in',
            $status === 404, $status === 405 => 'not found',
            $status >= 500 => 'server error',
            default => 'forbidden',
        };
    }

    private static function respond(array $body, int $status, array $headers, array $cookies): JsonResponse
    {
        $response = (new JsonResponse($body, $status, $headers, self::FLAGS))->header('Cache-Control', 'no-store');
        foreach ($cookies as $cookie) {
            $response->headers->setCookie($cookie);
        }

        return $response;
    }
}
