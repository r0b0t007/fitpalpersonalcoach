<?php

namespace App\Console\Commands;

use App\Auth\Bootstrap;
use App\Auth\SessionToken;
use App\Billing\Creem;
use App\Console\LiveChecks;
use App\Domain\Plans;
use App\Media\Upload;
use Illuminate\Console\Command;
use Throwable;

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
        // A Free plan as big as a paid one makes paying a downgrade: the coach would land over the
        // cap of the plan they just bought.
        $smallest = min(Plans::CAPS);
        if (Plans::freeCap() >= $smallest) {
            $warnings[] = 'FREE_CAP ('.Plans::freeCap().') is not below the smallest paid plan ('.ucfirst((string) array_search($smallest, Plans::CAPS, true)).", $smallest): upgrading would lower a coach's cap.";
        }
        if (config('fitpal.self_serve_coach') && ! Plans::selfServeOpen()) {
            $warnings[] = 'SELF_SERVE_COACH is on but there is nothing to sign up to: set FREE_CAP for the Free plan, or CREEM_API_KEY, CREEM_WEBHOOK_SECRET and CREEM_PRODUCTS for paid plans. Coach sign-up stays closed until then.';
        }
        array_push($warnings, ...self::mailProblems(), ...LiveChecks::origin(app()->isProduction()), ...LiveChecks::vapid());
        // Live only: on a laptop the Node API and Laravel may well share a data dir under two secrets.
        if (app()->isProduction()) {
            array_push($warnings, ...LiveChecks::secret((string) config('fitpal.data_dir')));
        }
        try {
            $stranded = LiveChecks::strandedPasskeys();
        } catch (Throwable) {
            $stranded = [];   // no database: LiveChecks::vapid has said so
        }
        if ($stranded !== []) {
            $warnings[] = count($stranded).' account(s) hold a passkey bound to '.implode(', ', array_unique($stranded)).', not to RP_ID ('.config('fitpal.rp_id').') — those passkeys cannot sign in here. Set RP_ID back to the host they were registered under.';
        }
        // With BOOTSTRAP_CODE set, Bootstrap::warnings already says this, with its own advice.
        if (app()->isProduction() && ! config('fitpal.invite_only') && (string) config('fitpal.bootstrap_code') === '') {
            $warnings[] = 'INVITE_ONLY is off: anyone who finds the sign-up can create an account with no coach. Set INVITE_ONLY=1 — a coach\'s invite link still works, and SELF_SERVE_COACH opens coach sign-up on its own.';
        }
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
        $transport = config("mail.mailers.{$mailer}.transport");
        if (! is_string($transport)) {
            // A typo (MAIL_MAILER=Resend) throws on every send, and the throw is only logged.
            return ["MAIL_MAILER is {$mailer}, which config/mail.php does not define — every mail fails. Set MAIL_MAILER=resend."];
        }
        if (in_array($transport, ['log', 'array'], true)) {
            // Fine on a laptop and in tests; on a live instance every link goes nowhere.
            if (app()->isProduction()) {
                $out[] = "MAIL_MAILER is {$mailer}: sign-in links and address confirmations are written to the log, not sent. Set MAIL_MAILER=resend and RESEND_API_KEY.";
            }

            return $out;
        }
        // A failover or round-robin mailer sends through its members: one of them is Resend with no
        // key, and every mail quietly falls through to the next (often the log). The key is the
        // mailer's own if it has one, as the transport reads it.
        $members = in_array($transport, ['failover', 'roundrobin'], true) ? (array) config("mail.mailers.{$mailer}.mailers") : [$mailer];
        $resend = false;
        foreach ($members as $name) {
            if (config("mail.mailers.{$name}.transport") !== 'resend') {
                continue;
            }
            $resend = true;
            if ((string) (config("mail.mailers.{$name}.key") ?? config('services.resend.key')) === '') {
                $out[] = "MAIL_MAILER is {$mailer} but RESEND_API_KEY is unset — no mail is sent through Resend.";
            }
        }
        // Resend refuses a sender on a domain it has not verified, wherever it runs; a local mail
        // catcher (Mailpit) takes anything, so the placeholder only matters there in production.
        $from = (string) config('mail.from.address');
        if (($resend || app()->isProduction()) && ($from === '' || str_ends_with(strtolower($from), '@example.com'))) {
            $out[] = 'MAIL_FROM_ADDRESS is '.($from === '' ? '(empty)' : $from).' — set the verified sender (no-reply@fitpal.ma), or the provider refuses every message.';
        }

        return $out;
    }
}
