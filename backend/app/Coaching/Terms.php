<?php

namespace App\Coaching;

use App\Models\User;
use App\Support\Js;

/**
 * The coach terms (CHW-357): the service, and the Art. 28 GDPR processor agreement between each
 * coach — the controller of their clients' data — and FitPal, the processor. Published on
 * fitpal.ma (site-coach/conditions.html, en/terms.html, es/terms.html), each page carrying this
 * version. A coach accepts the current one at sign-up, or in the app (views/coach/TermsGate.jsx).
 *
 * A new version: VERSION is its date, and EFFECTIVE at least 30 days later (the terms promise that
 * notice, Part A §9); coaches are told by email. Until EFFECTIVE, a coach who accepted an earlier
 * version is still bound by it and keeps using the app; from then, they are asked again, and one
 * who does not accept leaves with their clients' data. The very first version had nothing before
 * it, so it binds from the day it was published.
 */
final class Terms
{
    public const VERSION = '2026-11-01';

    public const EFFECTIVE = '2026-11-01';

    public static function accepted(User $coach, ?int $nowMs = null): bool
    {
        if ($coach->terms_version === self::VERSION) {
            return true;
        }

        return $coach->terms_version !== null && ($nowMs ?? Js::nowMs()) < self::effectiveMs();
    }

    /** Midnight UTC on EFFECTIVE, in ms. */
    public static function effectiveMs(): int
    {
        return strtotime(self::EFFECTIVE.' 00:00:00 UTC') * 1000;
    }
}
