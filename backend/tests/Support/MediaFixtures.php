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

    /** One JPEG segment: its marker, then a length that counts itself. */
    public static function seg(int $marker, string $data): string
    {
        return "\xFF".chr($marker).pack('n', strlen($data) + 2).$data;
    }

    /**
     * A JPEG's structure as a camera writes one, for App\Media\Jpeg (CHW-356), which reads segments
     * and never decodes: JFIF, an EXIF block naming a place, a comment, the tables, a $w×$h frame,
     * two scans (as a progressive file has) whose coded data holds a stuffed FF and a restart, the
     * end, and a motion photo's video after it.
     */
    public static function cameraJpeg(int $w = 1080, int $h = 1080): string
    {
        $scan = fn (string $coded) => self::seg(0xDA, "\x01\x01\x00\x00\x3F\x00").$coded;

        return "\xFF\xD8"
            .self::seg(0xE0, "JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00")
            .self::seg(0xE1, "Exif\0\0GPSLatitude 33.5731 N GPSLongitude 7.5898 W")
            .self::seg(0xFE, 'shot at home')
            .self::seg(0xDB, "\x00".str_repeat("\x10", 64))
            .self::seg(0xC2, "\x08".pack('n', $h).pack('n', $w)."\x01\x01\x11\x00")
            .self::seg(0xC4, "\x00".str_repeat("\x00", 16))
            .$scan("\x12\x34\xFF\x00\x56\xFF\xD0\x78")
            .self::seg(0xC4, "\x10".str_repeat("\x00", 16))
            .$scan("\x9A\xBC")
            ."\xFF\xD9"
            .pack('N', 24).'ftypmp42 motion photo video';
    }

    /** A raw-body POST, as the app's rawUpload sends it. */
    public static function post(?User $who, string $uri, string $body): TestResponse
    {
        $headers = ($who ? test()->transformHeadersToServerVars(bearer($who)) : [])
            + ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'];

        return test()->call('POST', $uri, [], [], [], $headers, $body);
    }
}
