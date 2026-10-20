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
            is_float($value) && $value === 0.0 => '0',   // String(-0) is "0"
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
        // n code points always cover n UTF-16 units: cut there first, so a 5 MB string is not
        // exploded into one PHP string per character to keep sixty of them.
        foreach (mb_str_split(mb_substr($s, 0, $n)) as $ch) {
            $units += strlen($ch) === 4 ? 2 : 1;
            if ($units > $n) {
                break;
            }
            $out .= $ch;
        }

        return $out;
    }

    /**
     * `JSON.stringify(JSON.parse(text))` for a decoded JSON value: what Node wrote to its files,
     * byte for byte, and what its size caps measured. Slashes, unicode and U+2028/U+2029 unescaped;
     * object keys in JS's order — integer-like keys ascending first, then the rest as they came;
     * -0 written as 0. (json_encode already writes 1.0 as 1.) One difference is left: an integral
     * float past PHP's int range but under 1e21 is written with an exponent where JS writes digits,
     * which no bundle field is.
     */
    public static function stringify(mixed $value, int $depth = 512): string
    {
        $json = json_encode(self::jsOrder($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR, $depth);

        // Numbers json_encode wrote in exponent form (1.0e-5, 1.0e+17), as JS writes them
        // (0.00001, 100000000000000000). Strings are matched first so their text is left alone.
        return preg_replace_callback('/"(?:\\\\.|[^"\\\\])*"|-?\d(?:\.\d+)?e[+-]?\d+/i',
            fn (array $m) => $m[0][0] === '"' ? $m[0] : self::jsNumber($m[0]), $json) ?? $json;
    }

    /**
     * Number.prototype.toString for a float json_encode wrote as d.ddde±x (already the shortest
     * digits that round-trip, which is also what JS picks): decimal notation for 1e-7 < |x| < 1e21,
     * JS's exponent form (1e+21, 1.5e-7) beyond.
     */
    private static function jsNumber(string $token): string
    {
        preg_match('/^(-?)(\d)(?:\.(\d+))?e([+-]?\d+)$/iD', $token, $m);
        $digits = rtrim($m[2].($m[3] ?? ''), '0') ?: '0';
        $k = strlen($digits);
        $n = (int) $m[4] + 1;
        $out = match (true) {
            $k <= $n && $n <= 21 => $digits.str_repeat('0', $n - $k),
            $n > 0 && $n <= 21 => substr($digits, 0, $n).'.'.substr($digits, $n),
            $n > -6 && $n <= 0 => '0.'.str_repeat('0', -$n).$digits,
            default => $digits[0].($k > 1 ? '.'.substr($digits, 1) : '').'e'.($n - 1 >= 0 ? '+' : '-').abs($n - 1),
        };

        return $m[1].$out;
    }

    /** Whether a decoded JSON value nests deeper than $limit — walked without recursion. */
    public static function deeperThan(mixed $value, int $limit): bool
    {
        $stack = [[$value, 1]];
        while ($stack) {
            [$v, $d] = array_pop($stack);
            if (! is_array($v) && ! $v instanceof \stdClass) {
                continue;
            }
            if ($d > $limit) {
                return true;
            }
            foreach (is_array($v) ? $v : get_object_vars($v) as $x) {
                $stack[] = [$x, $d + 1];
            }
        }

        return false;
    }

    private static function jsOrder(mixed $v): mixed
    {
        if (is_float($v)) {
            // -0.0 === 0.0 in PHP, and JSON.stringify(-0) is "0"; Infinity and NaN are null to JS.
            return $v === 0.0 ? 0 : (is_finite($v) ? $v : null);
        }
        if (is_array($v)) {
            return array_map(self::jsOrder(...), $v);
        }
        if (! $v instanceof \stdClass) {
            return $v;
        }
        $index = [];
        $rest = [];
        foreach (get_object_vars($v) as $k => $x) {
            // An array index to JS: a canonical non-negative integer below 2^32 - 1.
            $k = (string) $k;
            if (preg_match('/^(0|[1-9]\d{0,9})$/D', $k) && (int) $k < 4294967295) {
                $index[(int) $k] = $x;
            } else {
                $rest[$k] = $x;
            }
        }
        ksort($index);
        $o = new \stdClass;
        foreach ($index as $k => $x) {
            $o->{(string) $k} = self::jsOrder($x);
        }
        foreach ($rest as $k => $x) {
            $o->{$k} = self::jsOrder($x);
        }

        return $o;
    }

    /** `Date.now()`, through Laravel's clock so tests can move it. */
    public static function nowMs(): int
    {
        return (int) now()->getTimestampMs();
    }

    /** `new Date().toISOString()`: UTC, milliseconds, a Z. */
    public static function isoNow(): string
    {
        return now()->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    /**
     * `Date.parse(s)` for the timestamps the Node API wrote: ISO 8601 as toISOString() makes it,
     * and its shorter forms (a date alone, no seconds, an offset instead of Z). Null where JS has
     * NaN. A string without an offset is read as UTC — V8 reads a date-time without one as the
     * server's local time, and the server ran in UTC. V8's legacy fallback ("May 1 2026") is not
     * ported: no row the API wrote is in that shape, and such a row reads as NaN, which every
     * caller already treats as "very old".
     */
    public static function dateParse(mixed $s): ?int
    {
        if (! is_string($s) || ! preg_match('/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/D', $s, $m)) {
            return null;
        }
        [$y, $mo, $d] = [(int) $m[1], (int) ($m[2] ?? '' ?: 1), (int) ($m[3] ?? '' ?: 1)];
        [$h, $mi, $sec] = [(int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0)];
        if (! checkdate($mo, $d, $y) || $mi > 59 || $sec > 59
            || $h > 24 || ($h === 24 && ($mi || $sec || (int) ($m[7] ?? 0)))) {
            return null;
        }
        $ms = gmmktime($h, $mi, $sec, $mo, $d, $y) * 1000 + (int) substr(str_pad($m[7] ?? '', 3, '0'), 0, 3);
        $zone = $m[8] ?? '';
        if ($zone !== '' && $zone !== 'Z') {
            [$zh, $zm] = [(int) substr($zone, 1, 2), (int) substr($zone, 4, 2)];
            if ($zh > 23 || $zm > 59) {
                return null;
            }
            $ms -= ($zone[0] === '-' ? -1 : 1) * ($zh * 60 + $zm) * 60000;
        }

        return $ms;
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
