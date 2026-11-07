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
 * A new version: VERSION is its date, and EFFECTIVE 30 days later (the terms promise that notice,
 * Part A §9); coaches are told by email. Until EFFECTIVE, a coach who accepted an earlier version
 * is still bound by it and keeps using the app; from then, they are asked again, and one who does
 * not accept leaves with their clients' data.
 *
 * EFFECTIVE may equal VERSION only when nobody but the operator holds a version: run
 * `php artisan fitpal:terms-holders` on production before the change, and again once it deploys
 * (`on_earlier` must then be 0). It counts terms_version, not the coach column: an admin through
 * ADMIN_UIDS has no coach flag, and a demoted coach keeps what they accepted.
 *
 * Versions that bound from the day they were published, nobody but the operator holding one:
 * - 2026-11-01, the first.
 * - 2026-11-03: B6, a client's own deletion (CHW-363).
 * - 2026-11-05: B9 and Annexes 2 and 3, the nightly backup encrypted and copied to R2 (CHW-361).
 * - 2026-11-06: Part A §1, the publisher is an individual.
 * - 2026-11-07: Part A §4 bis, referrals; Part B §2, the referred coach authorises the referral
 *   check, of which FitPal is the controller (CHW-372, Referrals::TERMS_FROM). Checked on
 *   production before the merge: no account but the operator's held any terms_version.
 *
 * The pages deploy to Cloudflare Pages and this file with the backend, separately. Once EFFECTIVE
 * has passed, the app asks for VERSION as soon as the backend is live: check fitpal.ma shows the
 * new version line before (or as soon as) it is, so nobody accepts a text not yet published.
 */
final class Terms
{
    public const VERSION = '2026-11-07';

    public const EFFECTIVE = '2026-11-07';

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
