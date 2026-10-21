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

    /**
     * `body.key` when it is a string, else '' — the body as sent (Input::body), so a malformed one
     * is a 400 `bad json` here as it was at Node's readBody, and nothing has been trimmed.
     */
    public static function str(Request $request, string $key): string
    {
        // A top-level field of the body, never a path: Laravel's input('a.b') walked one, this does not.
        if (str_contains($key, '.')) {
            throw new \LogicException("Input::str reads a top-level body field, not a path: $key");
        }
        $value = self::raw($request, $key);

        return is_string($value) ? $value : '';
    }

    /**
     * `body.key` as nested arrays — for the WebAuthn credential, which the package reads as an
     * array — or null when it is not a JSON object, or nests past 64 levels (a real credential has
     * four): an anonymous caller does not get a deep structure re-encoded on their behalf.
     */
    public static function assoc(Request $request, string $key): ?array
    {
        $value = self::raw($request, $key);
        if (! $value instanceof stdClass || Js::deeperThan($value, 64)) {
            return null;
        }
        try {
            return Js::toAssoc($value, 66);
        } catch (\JsonException) {
            return null;
        }
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
     * Two bodies JSON.parse took that PHP cannot, both refused as `bad json` and neither one the
     * app ever sends: an object key that starts with NUL (`"\u0000x"`, which no PHP object can
     * hold as a property), and nesting past PHP's parser — about 2,500 objects or 5,000 arrays deep.
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

    /**
     * `new URL(req.url).searchParams.get(key)`: the FIRST value of that name, decoded as
     * URLSearchParams decodes (`+` is a space, %XX bytes read as UTF-8, a bad byte as U+FFFD), and
     * untouched otherwise. Laravel's query bag is not that: TrimStrings and ConvertEmptyStrings
     * have been through it, and PHP keeps the LAST of repeated names — so `?id=%20x%20` and
     * `?id=nope&id=x` would find an account Node answered "no such user" for.
     */
    public static function searchParam(Request $request, string $key): ?string
    {
        if (! $request->attributes->has('fitpal.query')) {
            $request->attributes->set('fitpal.query', self::parseQuery((string) $request->server->get('QUERY_STRING', '')));
        }

        return $request->attributes->get('fitpal.query')[$key] ?? null;
    }

    /** @return array<string, string> each name's first value, decoded; parsed once per request */
    private static function parseQuery(string $query): array
    {
        // mb_scrub substitutes '?' unless told otherwise; URLSearchParams writes U+FFFD.
        $was = mb_substitute_character();
        mb_substitute_character(0xFFFD);
        try {
            $decode = fn (string $s): string => mb_scrub(rawurldecode(str_replace('+', ' ', $s)), 'UTF-8');
            $params = [];
            foreach (explode('&', $query) as $pair) {
                if ($pair !== '') {
                    [$name, $value] = array_pad(explode('=', $pair, 2), 2, '');
                    $params[$decode($name)] ??= $decode($value);
                }
            }

            return $params;
        } finally {
            mb_substitute_character($was);
        }
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
