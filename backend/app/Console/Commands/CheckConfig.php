<?php

namespace App\Console\Commands;

use App\Auth\Bootstrap;
use App\Auth\SessionToken;
use App\Billing\Creem;
use App\Domain\Plans;
use App\Media\Upload;
use Illuminate\Console\Command;

/**
 * The configuration mistakes the Node API printed at boot, as a command a deploy runs (and an
 * operator can run any time). PHP has no long-lived boot to print them at: a warning per request
 * would bury the log.
 */
final class CheckConfig extends Command
{
    protected $signature = 'fitpal:check-config';

    protected $description = 'Report configuration that will not behave as intended';

    public function handle(): int
    {
        $warnings = Bootstrap::warnings();
        if (! SessionToken::configured()) {
            $warnings[] = 'SESSION_SECRET is unset or shorter than '.SessionToken::MIN_SECRET_LENGTH.' characters — nobody can sign in. In production it is the contents of the old DATA_DIR/secret.';
        }
        // PHP refuses a body over post_max_size before Laravel runs, so a larger media cap is one
        // nobody can reach: uploads are capped at post_max_size instead (Upload::maxVideo).
        $post = Upload::postMax();
        if ($post !== null && (int) config('fitpal.media_max_video_mb') * 1048576 > $post) {
            $warnings[] = 'MEDIA_MAX_VIDEO_MB ('.config('fitpal.media_max_video_mb').') is above PHP\'s post_max_size ('.Upload::mb($post).' MB) — a video sent as one request is capped at '.Upload::mb($post).' MB. Raise post_max_size (public/.user.ini, public/.htaccess) or lower the cap; keep both under Cloudflare\'s 100 MB.';
        }
        if (((string) config('fitpal.vapid.public') === '') !== ((string) config('fitpal.vapid.private') === '')) {
            $warnings[] = 'only one of VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY is set — set both, or neither (DATA_DIR/vapid.json is then used). No push is sent until then.';
        }
        // Creem: a partial set leaves billing off (every coach entitled) — say so, and name any
        // CREEM_PRODUCTS entry that is ignored.
        array_push($warnings, ...Plans::problems(), ...Creem::problems());
        if (config('fitpal.self_serve_coach') && ! Plans::billingOn()) {
            $warnings[] = 'SELF_SERVE_COACH is on but billing is off: coach sign-up stays closed until CREEM_API_KEY, CREEM_WEBHOOK_SECRET and CREEM_PRODUCTS are set (a self-serve coach is meant to pay).';
        }
        array_push($warnings, ...self::mailProblems());
        foreach ($warnings as $w) {
            $this->warn($w);
        }
        if ($warnings === []) {
            $this->info('configuration ok');
        }

        return $warnings === [] ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Mail is how a coach gets back in without a passkey (sign-in links, spec §4a) and how a new
     * sign-up confirms its address: a mailer that sends nothing fails quietly, link by link.
     *
     * @return list<string>
     */
    public static function mailProblems(): array
    {
        $out = [];
        $mailer = (string) config('mail.default');
        if (in_array($mailer, ['log', 'array'], true)) {
            // Fine on a laptop and in tests; on a live instance every link goes nowhere.
            if (app()->isProduction()) {
                $out[] = "MAIL_MAILER is {$mailer}: sign-in links and address confirmations are written to the log, not sent. Set MAIL_MAILER=resend and RESEND_API_KEY.";
            }

            return $out;
        }
        if ($mailer === 'resend' && (string) config('services.resend.key') === '') {
            $out[] = 'MAIL_MAILER is resend but RESEND_API_KEY is unset — no mail is sent.';
        }
        $from = (string) config('mail.from.address');
        if ($from === '' || str_ends_with($from, '@example.com')) {
            $out[] = "MAIL_FROM_ADDRESS is {$from} — set the verified sender (no-reply@fitpal.ma), or the provider refuses every message.";
        }

        return $out;
    }
}
