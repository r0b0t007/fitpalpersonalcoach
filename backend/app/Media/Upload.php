<?php

namespace App\Media;

use App\Support\ClientSafe;
use App\Support\Json;
use App\Support\Say;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A raw upload body, streamed to a temp file (api/server.js streamToFile). The body is never held
 * in memory: it is read in chunks, hashed (SHA-256) and written as it arrives, and its first
 * Sniff::BYTES are judged by Sniff::validate before anything past them is kept.
 *
 * Refusals come in Node's order and words — over the cap, then the sniff, then empty — each with
 * `Connection: close`, as Node's routes relayed them, so a client still sending stops. Every one
 * removes the temp file before it is thrown, so "a refused upload leaves nothing behind" is a
 * property a test can observe. The temp file is the caller's on success: it moves it into place.
 *
 * (On the host the web server buffers a request body before PHP sees it, so a refusal here does
 * not stop the bytes already sent; it still stops the next keep-alive request riding behind them.)
 */
final class Upload
{
    private const CHUNK = 65536;

    /** The upload routes, and the cap each one has: what a body over post_max_size is told. */
    private const ROUTES = ['media/exercise' => 'video', 'media/photo' => 'photo'];

    /** `mb(n)`: bytes as the whole megabytes the refusal names. */
    public static function mb(int $bytes): int
    {
        return (int) round($bytes / 1048576);
    }

    /**
     * The video cap: MEDIA_MAX_VIDEO_MB, but never above PHP's post_max_size — past that, PHP
     * refuses the body before any of this runs, and the cap a coach is told must be the real one.
     */
    public static function maxVideo(): int
    {
        return self::clamp((int) config('fitpal.media_max_video_mb') * 1048576);
    }

    /** The photo cap: MEDIA_MAX_PHOTO_MB, clamped the same way. */
    public static function maxPhoto(): int
    {
        return self::clamp((int) config('fitpal.media_max_photo_mb') * 1048576);
    }

    /** PHP's post_max_size in bytes, or null when it sets no limit. */
    public static function postMax(): ?int
    {
        $v = trim((string) ini_get('post_max_size'));
        if ($v === '' || $v === '0') {
            return null;
        }
        $n = (int) $v;

        return match (strtoupper(substr($v, -1))) {
            'G' => $n * 1073741824, 'M' => $n * 1048576, 'K' => $n * 1024, default => $n,
        };
    }

    /**
     * A body PHP refused for post_max_size, answered in the words of the upload it was: the media
     * cap, not the state sync's sentence. Null for any other route.
     */
    public static function tooLargeFor(Request $request): ?JsonResponse
    {
        foreach (self::ROUTES as $path => $want) {
            if ($request->is($path, 'api/'.$path)) {
                $cap = $want === 'video' ? self::maxVideo() : self::maxPhoto();

                return Json::error(413, Say::f('file is larger than the {0} MB limit', self::mb($cap)), [], Json::CLOSE);
            }
        }

        return null;
    }

    /**
     * @param  string  $want  'video' or 'photo'
     * @return array{tmp: string, bytes: int, sha: string, meta: array{kind: string, ext: string, mime: string, needsTranscode: bool}}
     *
     * @throws ClientSafe
     */
    public static function stream(Request $request, string $dir, int $maxBytes, string $want): array
    {
        // PHP keeps a multipart/form-data body for itself: php://input reads empty. Node read those
        // bytes like any other, and their first 64 were never a picture or a video.
        if (str_starts_with(strtolower((string) $request->headers->get('Content-Type')), 'multipart/') && (int) $request->server('CONTENT_LENGTH', 0) > 0) {
            throw new ClientSafe(415, 'not a recognised image or video file', [], Json::CLOSE);
        }
        $in = $request->getContent(true);
        if (! is_resource($in)) {
            throw new ClientSafe(500, 'could not write the file', [], Json::CLOSE);
        }
        $tmp = $dir.DIRECTORY_SEPARATOR.'.up-'.bin2hex(random_bytes(8));
        $out = @fopen($tmp, 'xb');
        if ($out === false) {
            throw new ClientSafe(500, 'could not write the file', [], Json::CLOSE);
        }
        // Removes the temp file, then throws the refusal it is handed.
        $fail = function (ClientSafe $refusal) use ($out, $tmp): never {
            if (is_resource($out)) {
                fclose($out);
            }
            @unlink($tmp);
            throw $refusal;
        };

        $hash = hash_init('sha256');
        $size = 0;
        $head = '';
        $meta = null;
        $sniff = function () use (&$head, &$meta, $want, $fail): void {
            $r = Sniff::validate($head, $want);
            if (isset($r['error'])) {
                $fail(new ClientSafe(415, $r['error'], [], Json::CLOSE)); // relayed: Sniff::validate's sentences, each pinned in tests/Unit/SniffTest
            }
            $meta = $r;
            $head = '';
        };

        while (! feof($in)) {
            $chunk = fread($in, self::CHUNK);
            if ($chunk === false) {
                $fail(new ClientSafe(400, 'upload interrupted', [], Json::CLOSE));
            }
            if ($chunk === '') {
                continue;
            }
            $size += strlen($chunk);
            // Judged per chunk as it arrives, the cap first: a body over it is refused as soon as
            // it is known to be, without reading the rest.
            if ($size > $maxBytes) {
                $fail(new ClientSafe(413, Say::f('file is larger than the {0} MB limit', self::mb($maxBytes)), [], Json::CLOSE));
            }
            if ($meta === null) {
                $head .= $chunk;
                if (strlen($head) >= Sniff::BYTES) {
                    $sniff();
                }
            }
            hash_update($hash, $chunk);
            if (fwrite($out, $chunk) !== strlen($chunk)) {
                $fail(new ClientSafe(500, 'could not write the file', [], Json::CLOSE));
            }
        }
        // Fewer bytes than the request declared: the client went away mid-body.
        $declared = $request->server('CONTENT_LENGTH');
        if (is_numeric($declared) && $size < (int) $declared) {
            $fail(new ClientSafe(400, 'upload interrupted', [], Json::CLOSE));
        }
        // Emptiness before format: "empty upload" is true and actionable, where sniffing nothing
        // would say "not a recognised image or video file" about a file never sent.
        if ($size === 0) {
            $fail(new ClientSafe(400, 'empty upload', [], Json::CLOSE));
        }
        // A body shorter than the window is still judged; Sniff turns a tiny one into a refusal.
        if ($meta === null) {
            $sniff();
        }
        if (! fclose($out)) {
            @unlink($tmp);
            throw new ClientSafe(500, 'could not write the file', [], Json::CLOSE);
        }

        return ['tmp' => $tmp, 'bytes' => $size, 'sha' => hash_final($hash), 'meta' => $meta];
    }

    private static function clamp(int $bytes): int
    {
        $post = self::postMax();

        return $post === null ? $bytes : min($bytes, $post);
    }
}
