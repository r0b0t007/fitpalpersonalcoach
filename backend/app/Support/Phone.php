<?php

namespace App\Support;

/**
 * A phone number as wa.me dials it: digits only, country code first (CHW-330). Spaces, dashes,
 * dots, brackets and a leading + or 00 are what people type around it and are dropped; anything
 * else, or a number with no country code (a leading 0), is not a number wa.me can open.
 *
 * Without the + or 00, only eleven digits or more (CHW-341): a national number in the markets
 * served is nine or ten, and 612345678 — a Spanish mobile — would otherwise be kept as +61, a
 * number in Australia. frontend/src/lib/whatsapp.js reads numbers the same way, and
 * phone-parity.json beside it holds the cases both run.
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
        if (preg_match('/^(?:\+|00)([1-9][0-9]{7,14})$/D', $s, $m)) {
            return $m[1];
        }

        return preg_match('/^[1-9][0-9]{10,14}$/D', $s) ? $s : null;
    }
}
