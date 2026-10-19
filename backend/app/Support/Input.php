<?php

namespace App\Support;

use Illuminate\Http\Request;
use stdClass;

/**
 * Reading caller input where the Node API read strings. `String(body.x || '')` never threw; PHP's
 * (string) cast on an array raises a warning that ends as a 500. An array, object or number where
 * a string belongs is treated as absent — a refusal of the route's own choosing, never a crash.
 */
final class Input
{
    /** Node's MAX_BODY: every JSON route but the state sync, which has its own 16 MB. */
    public const MAX_BODY = 5 * 1024 * 1024;

    public static function str(Request $request, string $key): string
    {
        $value = $request->input($key);

        return is_string($value) ? $value : '';
    }

    /**
     * api/server.js readBody: the body as sent, parsed once per request. Over 5 MB is a 413 and
     * text that is not JSON is 400 `bad json`, as Node answered them — and at the same point, so a
     * route calls this where Node called readBody (after its sign-in and role checks: an
     * anonymous bad body is still a 401). Nothing here has passed through TrimStrings, and objects
     * stay stdClass, so `{}` is stored as `{}`. An empty body is `{}`, as Node made it.
     *
     * @throws ClientSafe
     */
    public static function body(Request $request): stdClass
    {
        if (! $request->attributes->has('fitpal.body')) {
            $raw = $request->getContent();
            if (strlen($raw) > self::MAX_BODY) {
                throw new ClientSafe(413, Say::f('request body is larger than the {0} MB limit', 5));
            }
            $parsed = self::parse($raw);
            // JSON that is not an object (an array, a number) parses in Node too, and then has no
            // fields: every `body.x` is undefined.
            $request->attributes->set('fitpal.body', $parsed instanceof stdClass ? $parsed : new stdClass);
        }

        return $request->attributes->get('fitpal.body');
    }

    /**
     * `JSON.parse(buffer.toString('utf8'))`, the part of readBody both body readers share (this
     * one and the state sync): '' is `{}`; invalid UTF-8 becomes U+FFFD, as Buffer#toString made
     * it; a lone UTF-16 surrogate escape — what a JS slice() through an emoji leaves — parses, as
     * JSON.parse let it, written as U+FFFD (UTF-8 cannot hold half a character); anything else that
     * is not JSON is 400 `bad json`.
     *
     * @throws ClientSafe
     */
    public static function parse(string $raw): mixed
    {
        if ($raw === '') {
            return new stdClass;
        }
        $parsed = json_decode($raw, false, 100_000, JSON_INVALID_UTF8_SUBSTITUTE);
        if (json_last_error() === JSON_ERROR_UTF16) {
            $parsed = json_decode(self::loneSurrogates($raw), false, 100_000, JSON_INVALID_UTF8_SUBSTITUTE);
        }
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new ClientSafe(400, 'bad json');
        }

        return $parsed;
    }

    /**
     * Every `\uD800`–`\uDFFF` escape that is not half of a pair, as `�`. Escapes are read two
     * characters at a time from the left, so `\\u…` (an escaped backslash) is never mistaken for one.
     */
    private static function loneSurrogates(string $raw): string
    {
        return preg_replace_callback('/\\\\(u[dD][89abAB][0-9a-fA-F]{2}\\\\u[dD][c-fC-F][0-9a-fA-F]{2}|u[dD][89a-fA-F][0-9a-fA-F]{2}|.)/s',
            fn (array $m) => strlen($m[1]) === 5 ? '\\ufffd' : $m[0], $raw) ?? $raw;
    }

    /** `body.key` exactly as sent, or null when absent (Node's undefined). */
    public static function raw(Request $request, string $key): mixed
    {
        $body = self::body($request);

        return property_exists($body, $key) ? $body->{$key} : null;
    }

    /**
     * `String(body.key || '')` on the body as sent: where Node did NOT trim — a note keeps its
     * leading spaces, a revoke matches the code as typed — the untouched body is the only faithful
     * read. Numbers and booleans become text as JS writes them; null, false, 0 and '' become ''.
     */
    public static function jsString(Request $request, string $key): string
    {
        $value = self::raw($request, $key);

        return Js::truthy($value) ? Js::string($value) : '';
    }
}
