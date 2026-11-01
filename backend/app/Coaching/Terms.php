<?php

namespace App\Coaching;

use App\Models\User;

/**
 * The coach terms (CHW-357): the service, and the Art. 28 GDPR processor agreement between each
 * coach — the controller of their clients' data — and FitPal, the processor. Published on
 * fitpal.ma (site-coach/conditions.html, en/terms.html, es/terms.html), each page carrying this
 * version. A coach accepts the current one at sign-up, or once in the app; a new version is a new
 * date here and on the pages, and every coach is asked again.
 */
final class Terms
{
    public const VERSION = '2026-11-01';

    public static function accepted(User $coach): bool
    {
        return $coach->terms_version === self::VERSION;
    }
}
