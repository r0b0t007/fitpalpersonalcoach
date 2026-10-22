<?php

namespace Tests\Support;

use App\Models\User;
use Illuminate\Testing\TestResponse;

/**
 * Upload fixtures and requests for the media tests (exercise demos, progress photos), shared so
 * no two test files declare the same global helper. mkfix() is api/coach-smoke.sh's builder.
 */
final class MediaFixtures
{
    /** An ISO header (a brand, one compatible brand) with a marker at 2048 so contents differ. */
    public static function mkfix(string $brand, string $compat = '', string $marker = 'pad', int $size = 4096): string
    {
        $b = str_repeat("\0", $size);
        $b = substr_replace($b, pack('N', 32).'ftyp'.$brand.pack('N', 0).$compat, 0, 16 + strlen($compat));

        return substr_replace($b, $marker, 2048, strlen($marker));
    }

    /** A JPEG of $size bytes (its signature, then a marker so contents differ). */
    public static function jpeg(string $marker = 'jpg', int $size = 2048): string
    {
        return str_pad("\xFF\xD8\xFF\xE0".$marker, $size, "\0");
    }

    /** A raw-body POST, as the app's rawUpload sends it. */
    public static function post(?User $who, string $uri, string $body): TestResponse
    {
        $headers = ($who ? test()->transformHeadersToServerVars(bearer($who)) : [])
            + ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'];

        return test()->call('POST', $uri, [], [], [], $headers, $body);
    }
}
