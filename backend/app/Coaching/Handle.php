<?php

namespace App\Coaching;

/**
 * A coach page's handle (CHW-330): what follows coach.fitpal.ma/c/. Read the way a coach types
 * their Instagram name — a leading @ and capitals are dropped — and kept to what Instagram itself
 * allows, minus the dots a URL path would trip on at either end. The app checks the same rules
 * (frontend/src/lib/coach-page.js) to save a round trip; this is the one that decides.
 */
final class Handle
{
    /** The app's own paths and words a visitor would mistake for FitPal speaking. */
    public const RESERVED = ['api', 'admin', 'join', 'start', 'link', 'home', 'today', 'clients', 'programs',
        'account', 'settings', 'login', 'fitpal', 'coach', 'support', 'help', 'www', 'app'];

    public static function normalise(mixed $raw): string
    {
        return is_string($raw) ? strtolower(ltrim(trim($raw), '@')) : '';
    }

    public static function valid(string $handle): bool
    {
        return (bool) preg_match('/^[a-z0-9._]{3,30}$/D', $handle)
            && ! str_starts_with($handle, '.') && ! str_ends_with($handle, '.') && ! str_contains($handle, '..');
    }

    public static function reserved(string $handle): bool
    {
        return in_array($handle, self::RESERVED, true);
    }
}
