<?php

namespace App\Console\Commands;

use App\Auth\Bootstrap;
use App\Auth\SessionToken;
use App\Billing\Creem;
use App\Domain\Plans;
use App\Media\Upload;
use App\Models\PushSubscription;
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
        if (config('fitpal.self_serve_coach') && ! Plans::billingOn()) {
            $warnings[] = 'SELF_SERVE_COACH is on but billing is off: coach sign-up stays closed until CREEM_API_KEY, CREEM_WEBHOOK_SECRET and CREEM_PRODUCTS are set (a self-serve coach is meant to pay).';
        }
        array_push($warnings, ...self::mailProblems(), ...self::originProblems(app()->isProduction()), ...self::dataProblems());
        if (app()->isProduction() && ! config('fitpal.invite_only')) {
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
     * Passkeys are bound to RP_ID, which must be ORIGIN's host or a parent of it, or every
     * registration and sign-in fails. On a live instance ORIGIN is also https and not localhost:
     * WebAuthn wants it, and the session cookie is `__Host-gymsid` only over https — a plain-http
     * ORIGIN renames it and signs everyone out. fitpal:import-legacy refuses on these, since each
     * passkey keeps the RP_ID it was imported under.
     *
     * @return list<string>
     */
    public static function originProblems(bool $live): array
    {
        $rp = (string) config('fitpal.rp_id');
        $origin = (string) config('fitpal.origin');
        $host = (string) parse_url($origin, PHP_URL_HOST);
        $out = [];
        if ($host === '' || ($host !== $rp && ! str_ends_with($host, '.'.$rp))) {
            $out[] = "RP_ID ($rp) is not the host of ORIGIN ($origin), nor a parent domain of it — every passkey registration and sign-in fails.";
        }
        if ($live && ($rp === 'localhost' || $host === 'localhost')) {
            $out[] = 'RP_ID or ORIGIN is still localhost on a live instance — set both to the address the app is opened at (RP_ID=coach.fitpal.ma, ORIGIN=https://coach.fitpal.ma).';
        } elseif ($live && ! str_starts_with($origin, 'https://')) {
            $out[] = "ORIGIN ($origin) is not https — passkeys need it, and the session cookie would change name, signing everyone out.";
        }

        return $out;
    }

    /**
     * What a wrong DATA_DIR or session secret breaks without a word: the Node API's secret signs
     * every session and paired phone (fitpal.php), and DATA_DIR/vapid.json is the pair every
     * browser subscribed with — with no pair there and none in .env, Vapid mints a new one and
     * none of them is reached again.
     *
     * @return list<string>
     */
    public static function dataProblems(): array
    {
        $dir = rtrim((string) config('fitpal.data_dir'), '/\\');
        $out = [];
        $secret = @file_get_contents($dir.DIRECTORY_SEPARATOR.'secret');
        if (is_string($secret) && trim($secret) !== '' && ! hash_equals(trim($secret), (string) config('fitpal.session_secret'))) {
            $out[] = 'SESSION_SECRET is not the secret in DATA_DIR/secret — every session and paired phone it signed is refused. Copy the file\'s contents into SESSION_SECRET, or remove the file if the secret was changed on purpose.';
        }
        $envPair = (string) config('fitpal.vapid.public') !== '' || (string) config('fitpal.vapid.private') !== '';
        if (! $envPair && ! is_file($dir.DIRECTORY_SEPARATOR.'vapid.json') && self::hasSubscriptions()) {
            $out[] = "no VAPID pair: VAPID_* are unset and there is no vapid.json in DATA_DIR ($dir), so a new pair would be minted and no browser already subscribed would receive a push. Point DATA_DIR at the data the subscriptions came from, or set the VAPID keys.";
        }

        return $out;
    }

    private static function hasSubscriptions(): bool
    {
        try {
            return PushSubscription::query()->exists();
        } catch (Throwable) {
            return false;   // no database yet: nothing subscribed to lose
        }
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
