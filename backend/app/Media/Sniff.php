<?php

namespace App\Media;

use App\Support\Say;

/**
 * What an upload is, from its own leading bytes (api/domain.mjs sniffMedia, validateUpload,
 * safeMediaFile). `Content-Type` is whatever the uploader chose to send and is not evidence of
 * anything.
 *
 * MP4, QuickTime .mov, HEIC and AVIF are all the same container (ISO base media, a leading `ftyp`
 * box) and differ only by the four-character brands inside it, so the major brand AND the
 * compatible list after it are read — Apple writes the telling one in either. Only the first
 * SNIFF_BYTES are ever consulted, however much the caller passes in: walking a whole file once
 * classified a valid MP4 as `image/heic` because four payload bytes spelled `mif1`.
 *
 * This labels; it does not refuse what an iPhone produces. HEVC in a .mov is accepted and flagged
 * `needsTranscode` — the Camera app writes a .mov on both of its format settings, so refusing
 * QuickTime would refuse the coach's own camera roll.
 */
final class Sniff
{
    /** 64, not 32: the deciding brand is routinely past the first four compatible ones. */
    public const BYTES = 64;

    private const MP4 = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp4v', 'avc1', 'M4V ', 'dash', 'cmfc'];

    private const HEVC = ['hvc1', 'hev1'];

    private const HEIF = ['heic', 'heix', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

    private const AVIF = ['avif', 'avis'];

    private const ACCEPT_VIDEO = ['mp4', 'mov'];

    /** Every browser a client might open the app in can decode these four. */
    private const ACCEPT_PHOTO = ['jpg', 'png', 'webp', 'gif'];

    /**
     * What the bytes are, or null when they are nothing this knows. Descriptive only.
     *
     * @return array{kind: string, ext: string, mime: string, brand?: string}|null
     */
    public static function media(string $buf): ?array
    {
        if (strlen($buf) < 12) {
            return null;
        }
        if (str_starts_with($buf, "\xFF\xD8\xFF")) {
            return ['kind' => 'photo', 'ext' => 'jpg', 'mime' => 'image/jpeg'];
        }
        if (str_starts_with($buf, "\x89PNG\r\n\x1A\n")) {
            return ['kind' => 'photo', 'ext' => 'png', 'mime' => 'image/png'];
        }
        if (str_starts_with($buf, 'RIFF') && substr($buf, 8, 4) === 'WEBP') {
            return ['kind' => 'photo', 'ext' => 'webp', 'mime' => 'image/webp'];
        }
        if (str_starts_with($buf, 'GIF8')) {
            return ['kind' => 'photo', 'ext' => 'gif', 'mime' => 'image/gif'];
        }
        if (substr($buf, 4, 4) !== 'ftyp') {
            return null;
        }
        $brands = self::brands($buf);
        $has = fn (array $set) => array_intersect($brands, $set) !== [];
        // AVIF first: MIAF requires an AVIF to list `mif1`, which is also a HEIF brand.
        if ($has(self::AVIF)) {
            return ['kind' => 'photo', 'ext' => 'avif', 'mime' => 'image/avif', 'brand' => $brands[0]];
        }
        if ($has(self::HEIF)) {
            return ['kind' => 'photo', 'ext' => 'heic', 'mime' => 'image/heic', 'brand' => $brands[0]];
        }
        if ($brands[0] === 'qt  ') {
            return ['kind' => 'video', 'ext' => 'mov', 'mime' => 'video/quicktime', 'brand' => $brands[0]];
        }
        if ($has(self::HEVC)) {
            $hevc = array_values(array_intersect($brands, self::HEVC))[0];

            return ['kind' => 'video', 'ext' => 'mp4', 'mime' => 'video/mp4', 'brand' => $hevc];
        }
        if ($has(self::MP4)) {
            return ['kind' => 'video', 'ext' => 'mp4', 'mime' => 'video/mp4', 'brand' => $brands[0]];
        }

        return null;
    }

    /**
     * The upload gate: `['error' => …]`, or the accepted descriptor. The sentences are the app's
     * translation keys, and say what to change, because the reader is the coach who just filmed it.
     *
     * `needsTranscode` means "nothing downstream should assume a browser can play this yet" — set
     * for QuickTime and for an HEVC brand. False is the best guess without a parser, not a promise.
     *
     * @return array{error: string}|array{kind: string, ext: string, mime: string, needsTranscode: bool}
     */
    public static function validate(string $buf, string $want): array
    {
        $m = self::media($buf);
        if ($m === null) {
            return ['error' => 'not a recognised image or video file'];
        }
        if ($m['kind'] !== $want) {
            return ['error' => $want === 'video' ? Say::f('expected a video, got {0}', $m['mime']) : Say::f('expected an image, got {0}', $m['mime'])];
        }
        if ($want === 'video') {
            if (! in_array($m['ext'], self::ACCEPT_VIDEO, true)) {
                return ['error' => Say::f('{0} is not a supported video format — use MP4 or MOV', $m['mime'])];
            }

            return ['kind' => $m['kind'], 'ext' => $m['ext'], 'mime' => $m['mime'],
                'needsTranscode' => $m['ext'] === 'mov' || in_array($m['brand'] ?? null, self::HEVC, true)];
        }
        // Photos stay narrow: the app re-encodes them on a canvas before upload, which turns an
        // iPhone's HEIC into a JPEG for free — so a HEIC that arrives was sent around the app.
        if ($m['ext'] === 'heic') {
            return ['error' => 'HEIC photos do not display in most browsers — set the camera to “Most Compatible”, or export as JPEG'];
        }
        if (! in_array($m['ext'], self::ACCEPT_PHOTO, true)) {
            return ['error' => Say::f('{0} is not a supported image format — use JPEG, PNG, WebP or GIF', $m['mime'])];
        }

        return ['kind' => $m['kind'], 'ext' => $m['ext'], 'mime' => $m['mime'], 'needsTranscode' => false];
    }

    /**
     * May the server open a file name it read from its own metadata? A whitelist: a leading dot
     * is refused (the upload routes' temp files are `.up-…`); `-` and `_` are ordinary, because a
     * photo's base64url name starts with one 2 times in 64. Not a string → no, never a crash.
     */
    public static function safeFile(mixed $name): bool
    {
        return is_string($name) && preg_match('/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/D', $name) === 1 && ! str_contains($name, '..');
    }

    /** The major brand at 8, then the compatible list from 16 — clamped to the box, the bytes in hand, and the window. */
    private static function brands(string $buf): array
    {
        $brands = [substr($buf, 8, 4)];
        $declared = unpack('N', substr($buf, 0, 4))[1];
        // A declared size of 0 means "to the end of the file" in ISO-BMFF: not a length.
        $end = min($declared ?: strlen($buf), strlen($buf), self::BYTES);
        for ($i = 16; $i + 4 <= $end; $i += 4) {
            $brands[] = substr($buf, $i, 4);
        }

        return $brands;
    }
}
