<?php

namespace App\Coaching;

use App\Models\CoachPage;
use App\Models\User;

/**
 * Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md). A coach
 * shares fitpal.ma/?ref=<their page's handle>, and the ref rides the URLs to the sign-up. A coach
 * who signs up through it, and whose join-request client trains, banks the referrer one month.
 * Banked only: no licence changes here. The owner applies a month when the coach pays.
 */
final class Referrals
{
    /** A ref as a link carries it, or null for one that is no public page's handle. */
    public static function normaliseRef(mixed $raw): ?string
    {
        $handle = Handle::normalise($raw);

        return Handle::valid($handle) && ! Handle::reserved($handle) ? $handle : null;
    }

    /**
     * The coach a new coach's ref names, while they coach (an enabled coach with that page), and
     * never one whose own address is the new coach's. Null otherwise: the sign-up goes ahead
     * without one.
     */
    public static function referrerFor(?string $ref, string $email): ?User
    {
        $handle = self::normaliseRef($ref);
        if ($handle === null) {
            return null;
        }
        [, $coach] = CoachPage::findPublic($handle);
        if ($coach === null || ($coach->email !== null && mb_strtolower($coach->email) === mb_strtolower($email))) {
            return null;
        }

        return $coach;
    }
}
