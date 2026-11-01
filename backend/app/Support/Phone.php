<?php

namespace App\Support;

/**
 * A phone number as wa.me dials it: digits only, country code first (CHW-330). Spaces, dashes,
 * dots, brackets and a leading + or 00 are what people type around it and are dropped; anything
 * else, or a number with no country code (a leading 0), is not a number wa.me can open.
 */
final class Phone
{
    /** '' for blank, the digits for a number, null for something that is not one. */
    public static function digits(mixed $raw): ?string
    {
        if ($raw === null || (is_string($raw) && trim($raw) === '')) {
            return '';
        }
        if (! is_string($raw)) {
            return null;
        }
        $s = (string) preg_replace('/[\s\-.()]/', '', $raw);
        $s = str_starts_with($s, '+') ? substr($s, 1) : (str_starts_with($s, '00') ? substr($s, 2) : $s);

        return preg_match('/^[1-9][0-9]{7,14}$/D', $s) ? $s : null;
    }
}
