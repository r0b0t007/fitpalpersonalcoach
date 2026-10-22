<?php

namespace App\Media;

use App\Support\Json;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * A stored media file, with HTTP ranges (api/server.js serveMedia). <video> seeks with range
 * requests, and Safari will not start playback without a 206 for its opening probe.
 *
 * Deliberately narrow, as Node was: ONE range. A range this cannot act on — a multi-range, an
 * unknown unit, something malformed — is ignored and the whole file sent with a 200 (RFC 9110
 * §14.2), never a 416: 416 means "that range does not exist in this file", and is only for one
 * that parsed and cannot be met. Open, suffix and over-long ranges are clamped.
 *
 * Written by hand rather than with BinaryFileResponse, whose own range handling answers those
 * cases differently, and which adds validators (ETag, Last-Modified) Node never sent.
 */
final class Serve
{
    private const CHUNK = 262144;

    public static function file(Request $request, string $path, ?string $mime): Response
    {
        clearstatcache(true, $path);
        if (! is_file($path)) {
            return Json::error(404, 'not found');
        }
        $total = (int) filesize($path);
        // Names are content-addressed or random, so a URL cannot change meaning and may be cached
        // for good. `private`: the route is behind a session, and a shared cache would hand its
        // copy to whoever asked next. (Symfony writes the directives sorted — "immutable,
        // max-age=31536000, private" — the same header in another order.)
        $base = [
            'Content-Type' => $mime ?: 'application/octet-stream',
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => 'private, max-age=31536000, immutable',
        ];

        $range = $request->headers->get('Range');
        if ($range === null) {
            return self::send($request, $path, 200, $base + ['Content-Length' => (string) $total], 0, $total);
        }
        if (! preg_match('/^bytes=(\d*)-(\d*)$/D', trim($range), $m) || ($m[1] === '' && $m[2] === '')) {
            return self::send($request, $path, 200, $base + ['Content-Length' => (string) $total], 0, $total);
        }
        if ($m[1] === '') {
            // A suffix range, "the last N bytes": N past the size is the whole file.
            $n = (int) $m[2];
            if ($n === 0) {
                return self::unsatisfiable($request, $total);
            }
            [$start, $end] = [max(0, $total - $n), $total - 1];
        } else {
            // (int) saturates at PHP_INT_MAX on a longer digit string, as JS read it large.
            $start = (int) $m[1];
            $end = $m[2] === '' ? $total - 1 : min((int) $m[2], $total - 1);
        }
        // Covers the empty file too: with nothing in it, every range is unsatisfiable.
        if ($start > $end || $start >= $total) {
            return self::unsatisfiable($request, $total);
        }

        return self::send($request, $path, 206, $base + [
            'Content-Range' => "bytes $start-$end/$total",
            'Content-Length' => (string) ($end - $start + 1),
        ], $start, $end - $start + 1);
    }

    /**
     * Not the file's headers: a 416 cached for a year as `immutable` would tell a browser the
     * demo can never be read, and the URL has no Vary: Range to stop it serving that back for an
     * ordinary GET. Errors are no-store, as every JSON answer is.
     */
    private static function unsatisfiable(Request $request, int $total): Response
    {
        $headers = ['Cache-Control' => 'no-store', 'Accept-Ranges' => 'bytes', 'Content-Range' => "bytes */$total"];

        return $request->isMethod('HEAD')
            ? new Response('', 416, $headers + ['Content-Type' => 'application/json'])
            : Json::error(416, 'range not satisfiable', [], $headers);
    }

    /**
     * The file is opened and positioned BEFORE the response exists: once the status and
     * Content-Length are sent there is no honest way to say it could not be read, and a 206
     * promising bytes that never come stalls a <video> until it times out. A file gone or unreadable
     * between the stat and here is answered as missing.
     */
    private static function send(Request $request, string $path, int $status, array $headers, int $offset, int $length): Response
    {
        $head = $request->isMethod('HEAD');
        $f = $head || $length <= 0 ? null : @fopen($path, 'rb');
        if ($f === false || ($f !== null && fseek($f, $offset) !== 0)) {
            return Json::error(404, 'not found');
        }

        return new StreamedResponse(function () use ($f, $length) {
            if ($f === null) {
                return;
            }
            for ($left = $length; $left > 0 && ! feof($f) && ! connection_aborted();) {
                $chunk = fread($f, min(self::CHUNK, $left));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                flush();
                $left -= strlen($chunk);
            }
            fclose($f);
        }, $status, $headers);
    }
}
