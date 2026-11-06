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
 * it, so it bound from the day it was published. So did 2026-11-03 (clause B6: a client's own
 * deletion, CHW-363): no real coach had accepted 2026-11-01, so none was owed the notice. And
 * 2026-11-05 (B9, Annexes 2 and 3: the nightly backup encrypted and copied to R2 in the EU,
 * CHW-361), for the same reason: every coach account is still a test account. And 2026-11-06
 * (Part A §1: the publisher is an individual; the ICE and the auto-entrepreneur status named
 * before were never FitPal's), for the same reason, checked on production that day: one coach
 * account (the operator's), which had accepted no version at all.
 *
 * Self-serve coach sign-up is open (SELF_SERVE_COACH), so a real coach may have accepted by the
 * next change: from then, EFFECTIVE is 30 days after VERSION, unless the same check, run on
 * production first, finds no coach but the operator's has accepted any version.
 *
 * The pages deploy to Cloudflare Pages and this file with the backend, separately. Once EFFECTIVE
 * has passed, the app asks for VERSION as soon as the backend is live: check fitpal.ma shows the
 * new version line before (or as soon as) it is, so nobody accepts a text not yet published.
 */
final class Terms
{
    public const VERSION = '2026-11-06';

    public const EFFECTIVE = '2026-11-06';

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
