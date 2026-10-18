<?php

namespace App\Support;

/**
 * JavaScript's reading of a value, for code that reads the app's state blob the way the Node API
 * did. `S.x || fallback` falls back on null, undefined, false, 0, '' and NaN — and NOT on an empty
 * array or object, nor on the string '0', which PHP's own truthiness gets wrong both ways.
 *
 * The state is decoded with objects as stdClass (json_decode without assoc), so `{}` stays an
 * object and goes back out as `{}`, never `[]`.
 */
final class Js
{
    public static function truthy(mixed $value): bool
    {
        return ! ($value === null || $value === false || $value === 0 || $value === 0.0 || $value === ''
            || (is_float($value) && is_nan($value)));
    }

    /** `value || fallback`. */
    public static function or(mixed $value, mixed $fallback): mixed
    {
        return self::truthy($value) ? $value : $fallback;
    }

    /** A value to iterate as `(value || [])`: the list when it is one, otherwise nothing. */
    public static function list(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }

    /** `new Date().toISOString()`: UTC, milliseconds, a Z. */
    public static function isoNow(): string
    {
        return now()->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    /** api/domain.mjs addDaysISO: a calendar date moved by whole days, '' for anything else. */
    public static function addDaysIso(string $iso, int $days): string
    {
        if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $iso, $m)) {
            return '';
        }

        return gmdate('Y-m-d', gmmktime(12, 0, 0, (int) $m[2], (int) $m[3] + $days, (int) $m[1]));
    }
}
