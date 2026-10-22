<?php

namespace App\Media;

use App\Support\ClientSafe;
use App\Support\Say;
use Illuminate\Http\Request;

/**
 * A raw upload body, streamed to a temp file (api/server.js streamToFile). The body is never held
 * in memory: it is read in chunks, hashed (SHA-256) and written as it arrives, and its first
 * Sniff::BYTES are judged by Sniff::validate before anything past them is kept.
 *
 * Refusals come in Node's order and words — over the cap, then the sniff, then empty — and every
 * one removes the temp file before it is thrown, so "a refused upload leaves nothing behind" is a
 * property a test can observe. The temp file is the caller's on success: it moves it into place.
 */
final class Upload
{
    private const CHUNK = 65536;

    /** `mb(n)`: bytes as the whole megabytes the refusal names. */
    public static function mb(int $bytes): int
    {
        return (int) round($bytes / 1048576);
    }

    /** The video cap (MEDIA_MAX_VIDEO_MB), in bytes. */
    public static function maxVideo(): int
    {
        return (int) config('fitpal.media_max_video_mb') * 1048576;
    }

    /** The photo cap (MEDIA_MAX_PHOTO_MB), in bytes. */
    public static function maxPhoto(): int
    {
        return (int) config('fitpal.media_max_photo_mb') * 1048576;
    }

    /**
     * @param  string  $want  'video' or 'photo'
     * @return array{tmp: string, bytes: int, sha: string, meta: array{kind: string, ext: string, mime: string, needsTranscode: bool}}
     *
     * @throws ClientSafe
     */
    public static function stream(Request $request, string $dir, int $maxBytes, string $want): array
    {
        $tmp = $dir.DIRECTORY_SEPARATOR.'.up-'.bin2hex(random_bytes(8));
        $in = $request->getContent(true);
        $out = @fopen($tmp, 'xb');
        if (! is_resource($in) || $out === false) {
            throw new ClientSafe(500, 'could not write the file');
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
                $fail(new ClientSafe(415, $r['error'])); // relayed: Sniff::validate's sentences, each pinned in tests/Unit/SniffTest
            }
            $meta = $r;
            $head = '';
        };

        while (! feof($in)) {
            $chunk = fread($in, self::CHUNK);
            if ($chunk === false) {
                $fail(new ClientSafe(400, 'upload interrupted'));
            }
            if ($chunk === '') {
                continue;
            }
            $size += strlen($chunk);
            // Judged per chunk as it arrives, the cap first: a body over it is refused as soon as
            // it is known to be, without reading the rest.
            if ($size > $maxBytes) {
                $fail(new ClientSafe(413, Say::f('file is larger than the {0} MB limit', self::mb($maxBytes))));
            }
            if ($meta === null) {
                $head .= $chunk;
                if (strlen($head) >= Sniff::BYTES) {
                    $sniff();
                }
            }
            hash_update($hash, $chunk);
            if (fwrite($out, $chunk) !== strlen($chunk)) {
                $fail(new ClientSafe(500, 'could not write the file'));
            }
        }
        // Fewer bytes than the request declared: the client went away mid-body.
        $declared = $request->server('CONTENT_LENGTH');
        if (is_numeric($declared) && $size < (int) $declared) {
            $fail(new ClientSafe(400, 'upload interrupted'));
        }
        // Emptiness before format: "empty upload" is true and actionable, where sniffing nothing
        // would say "not a recognised image or video file" about a file never sent.
        if ($size === 0) {
            $fail(new ClientSafe(400, 'empty upload'));
        }
        // A body shorter than the window is still judged; Sniff turns a tiny one into a refusal.
        if ($meta === null) {
            $sniff();
        }
        if (! fclose($out)) {
            @unlink($tmp);
            throw new ClientSafe(500, 'could not write the file');
        }

        return ['tmp' => $tmp, 'bytes' => $size, 'sha' => hash_final($hash), 'meta' => $meta];
    }
}
