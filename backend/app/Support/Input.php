<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Reading caller input where the Node API read strings. `String(body.x || '')` never threw; PHP's
 * (string) cast on an array raises a warning that ends as a 500. An array, object or number where
 * a string belongs is treated as absent — a refusal of the route's own choosing, never a crash.
 */
final class Input
{
    public static function str(Request $request, string $key): string
    {
        $value = $request->input($key);

        return is_string($value) ? $value : '';
    }

    /**
     * `String(body.key || '')` on the body exactly as sent. Laravel's TrimStrings has already
     * trimmed the request's JSON bag, and where Node did NOT trim — a note keeps its leading
     * spaces, a revoke matches the code as typed — the untouched body is the only faithful read.
     * Numbers and booleans become text as JS would write them; null, false, 0 and '' become ''.
     */
    public static function jsString(Request $request, string $key): string
    {
        $body = json_decode($request->getContent());
        $value = is_object($body) && property_exists($body, $key) ? $body->{$key} : null;

        return Js::truthy($value) ? Js::string($value) : '';
    }
}
