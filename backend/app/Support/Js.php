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

    /** `String(value)`: what JS writes for a decoded JSON value. */
    public static function string(mixed $value): string
    {
        return match (true) {
            is_string($value) => $value,
            $value === null => 'null',
            is_bool($value) => $value ? 'true' : 'false',
            is_int($value) => (string) $value,
            is_float($value) => is_nan($value) ? 'NaN' : (is_infinite($value) ? ($value > 0 ? 'Infinity' : '-Infinity')
                : (floor($value) === $value && abs($value) < 1e21 ? sprintf('%.0f', $value) : json_encode($value))),
            is_array($value) => implode(',', array_map(fn ($v) => $v === null ? '' : self::string($v), $value)),
            default => '[object Object]',
        };
    }

    /**
     * `+value` / `Number(value)` on a decoded JSON value: a string is trimmed and read as a decimal
     * literal (or 0x/0o/0b, or Infinity), '' is 0, true is 1, an array is read through its string,
     * an object is NaN.
     */
    public static function toNumber(mixed $value): float
    {
        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }
        if (is_bool($value) || $value === null) {
            return $value ? 1.0 : 0.0;
        }
        if (is_array($value)) {
            return self::toNumber(self::string($value));
        }
        if (! is_string($value)) {
            return NAN;
        }
        $s = self::trim($value);
        if ($s === '') {
            return 0.0;
        }
        if (preg_match('/^0([xob])([0-9a-f]+)$/i', $s, $m)) {
            $base = ['x' => 16, 'o' => 8, 'b' => 2][strtolower($m[1])];
            $digits = strtolower($m[2]);

            return strspn($digits, substr('0123456789abcdef', 0, $base)) === strlen($digits) ? (float) base_convert($digits, $base, 10) : NAN;
        }
        if (preg_match('/^([+-]?)Infinity$/', $s, $m)) {
            return $m[1] === '-' ? -INF : INF;
        }

        return preg_match('/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i', $s) ? (float) $s : NAN;
    }

    /** `String.prototype.trim`: JS whitespace and line terminators, not only PHP's six bytes. */
    public static function trim(string $s): string
    {
        return preg_replace('/^[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+|[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+$/u', '', $s) ?? $s;
    }

    /**
     * `s.slice(0, n)`: n UTF-16 code units, as JS counts — a character outside the BMP is two. One
     * that would be cut in half is left out (JS would keep half of it, which no UTF-8 can hold).
     */
    public static function slice(string $s, int $n): string
    {
        $out = '';
        $units = 0;
        foreach (mb_str_split($s) as $ch) {
            $units += strlen($ch) === 4 ? 2 : 1;
            if ($units > $n) {
                break;
            }
            $out .= $ch;
        }

        return $out;
    }

    /**
     * `JSON.stringify(value)` for a decoded JSON value: no escaped slashes or unicode, and a float
     * with no fraction written as JS writes it (1, not 1.0). Its byte length is what Node's size
     * caps measured, and it is what a stored bundle should read back as.
     */
    public static function stringify(mixed $value): string
    {
        return json_encode(self::integralFloats($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private static function integralFloats(mixed $v): mixed
    {
        if (is_float($v)) {
            return is_finite($v) && floor($v) === $v && abs($v) < 2 ** 53 ? (int) $v : $v;
        }
        if (is_array($v)) {
            return array_map(self::integralFloats(...), $v);
        }
        if ($v instanceof \stdClass) {
            $o = new \stdClass;
            foreach (get_object_vars($v) as $k => $x) {
                $o->{$k} = self::integralFloats($x);
            }

            return $o;
        }

        return $v;
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
