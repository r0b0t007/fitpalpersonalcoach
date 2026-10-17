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

    /** @param list<Cookie> $cookies */
    public static function ok(array $body, int $status = 200, array $headers = [], array $cookies = []): JsonResponse
    {
        return self::respond($body, $status, $headers, $cookies);
    }

    public static function error(int $status, string $error, array $extra = [], array $headers = []): JsonResponse
    {
        return self::respond(Say::envelope($error, $extra), $status, $headers, []);
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
