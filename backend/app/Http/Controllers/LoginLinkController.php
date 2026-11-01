<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Audit\ClientIp;
use App\Auth\FreshAuth;
use App\Auth\SessionToken;
use App\Mail\AccountMail;
use App\Mail\SendAfterResponse;
use App\Models\LoginLink;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Json;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

use function Illuminate\Support\defer;

/**
 * Signing in by email (spec §4a, R4; Laravel only): a mail with a link and a 6-digit code, and
 * changing the address those mails go to. A coach's second way in beside their passkey; since
 * CHW-331 a client's too, once their address is proven (a join request accepted), because a
 * passkey fails inside Instagram's browser, where most clients arrive.
 *
 *  - POST /api/login/email {email} always answers {ok: true} — unknown, a disabled account's, a
 *    pending or unproven address, throttled: all alike, so it cannot tell anyone whether an
 *    address has an account. An account that may sign in with it (mayUseEmail) gets the mail.
 *  - POST /api/login/code {email, code} signs in with the newest mail's code, in the browser that
 *    asked: the main path, as a tapped link opens another browser and leaves Instagram's. Every
 *    refusal reads alike and takes as long, whether the address has an account or not. Wrong
 *    codes spend only the code, never the mail's link: a stranger who knows the address can stop
 *    the codes working for a day, but not the link already in the inbox.
 *  - POST /api/login/link {t} redeems either kind of link: a sign-in link signs in exactly as a
 *    passkey does (SessionToken::cookies, so `logout/all` ends it too); an email-change link moves
 *    the pending address into `email` and tells the old one.
 *  - POST /api/account/email {email} (signed in) only writes `pending_email` and mails the new
 *    address, and only from a session that signed in just now (FreshAuth): a live session alone
 *    — a shared laptop, a paired phone — can never point the account's recovery at another inbox.
 *    Sending the link again to the address already pending is the one exception: it points at
 *    no inbox the account was not already waiting on.
 */
final class LoginLinkController
{
    /** 3 links per address per 15 minutes; 10 requests per IP per hour (spec §4a). */
    private const PER_EMAIL = [3, 900];

    private const PER_IP = [10, 3600];

    /**
     * Per connection, whatever it says it forwards: CF-Connecting-IP is believed for PER_IP (the
     * client behind Cloudflare), but a caller reaching the server directly can say anything there.
     * Generous, as every coach behind one Cloudflare edge shares it.
     */
    private const PER_PEER = [300, 3600];

    /**
     * Tries per address a day, for any address so that being refused says nothing about it, and
     * not cleared by a new mail, which a stranger can ask for: 20 guesses a day at a million codes.
     * A sign-in clears it. Each code is also spent after LoginLink::MAX_ATTEMPTS wrong tries.
     */
    private const CODE_PER_EMAIL = [20, 86400];

    /**
     * Tries per client address an hour: guessing across many addresses at once. Generous, as a
     * mobile carrier puts many people behind one address.
     */
    private const CODE_PER_IP = [60, 3600];

    /** Every refused code takes at least this long, so the time a refusal takes says nothing either. */
    private const CODE_REFUSAL_MS = 400;

    /** At most this many `login.link.throttled` rows an hour: a flood must not push real events out of the log. */
    private const THROTTLE_AUDITS = 20;

    public function request(Request $request): JsonResponse
    {
        $email = LoginLink::normaliseEmail(Input::jsString($request, 'email'));
        // The client's address, not the proxy's: behind Cloudflare $request->ip() is its edge, and
        // every coach on that edge would share one bucket.
        $ip = ClientIp::for($request, 'full') ?? (string) $request->ip();
        $buckets = [
            'login-link:email:'.hash('sha256', $email) => self::PER_EMAIL,
            'login-link:ip:'.$ip => self::PER_IP,
            'login-link:peer:'.$request->server('REMOTE_ADDR') => self::PER_PEER,
        ];
        foreach ($buckets as $key => [$max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                // The address is not recorded: a log of what strangers typed is a liability.
                RateLimiter::attempt('login-link:throttle-audit', self::THROTTLE_AUDITS,
                    fn () => Audit::record($request, 'login.link.throttled', ['ok' => false]), 3600);

                return Json::ok(['ok' => true]);
            }
        }
        foreach ($buckets as $key => [, $decay]) {
            RateLimiter::hit($key, $decay);
        }

        // What is kept on the link row follows the owner's AUDIT_IP, as the audit log does.
        $stored = ClientIp::for($request, (string) config('fitpal.audit.ip'));

        // Only the lookup happens before the answer, the same for any address: the link, the
        // coach's language and the mail all come after it (defer), so timing tells nobody anything.
        $user = LoginLink::validEmail($email) ? self::accountWithEmail($email) : null;
        if ($user !== null) {
            defer(function () use ($user, $stored) {
                [$token, , $code] = LoginLink::issue($user, 'login', null, $stored);
                SendAfterResponse::send($user->email, new AccountMail('signin', $user, LoginLink::url($token), code: $code));
            });
        }

        return Json::ok(['ok' => true]);
    }

    public function code(Request $request): JsonResponse
    {
        $started = hrtime(true);
        $email = LoginLink::normaliseEmail(Input::jsString($request, 'email'));
        $code = Input::jsString($request, 'code');
        $ip = ClientIp::for($request, 'full') ?? (string) $request->ip();
        // Counted before the code is looked at, so that requests sent at once cannot all pass a
        // limit none of them has counted yet. A sign-in takes its try back from the address.
        $buckets = [
            self::codeKey($email) => self::CODE_PER_EMAIL,
            'login-code:ip:'.$ip => self::CODE_PER_IP,
            'login-code:peer:'.$request->server('REMOTE_ADDR') => self::PER_PEER,
        ];
        foreach ($buckets as $key => [$max, $decay]) {
            if (RateLimiter::hit($key, $decay) > $max) {
                self::evenOut($started);
                throw new ClientSafe(429, 'too many wrong codes — use the link in the email, or try again later');
            }
        }
        // Decided under the link's lock and committed whatever the answer: a wrong code must count.
        $user = DB::transaction(function () use ($email, $code): ?User {
            $user = LoginLink::validEmail($email) ? self::accountWithEmail($email) : null;
            // The newest mail's code only: a new mail takes the older codes away (LoginLink::issue).
            $link = $user === null ? null : LoginLink::query()->where('user_id', $user->id)->where('purpose', 'login')
                ->whereNull('used_at')->whereNotNull('code_hash')->where('expires_at', '>', now())
                ->lockForUpdate()->first();
            if ($link === null) {
                return null;
            }
            if (preg_match('/^\d{6}$/', $code) !== 1 || ! hash_equals((string) $link->code_hash, LoginLink::codeHash($link->id, $code))) {
                // The code is spent after the last try, not the row: its link still works.
                $tries = $link->attempts + 1;
                $link->forceFill(['attempts' => $tries] + ($tries >= LoginLink::MAX_ATTEMPTS ? ['code_hash' => null] : []))->save();

                return null;
            }
            // As a link: one used, every other sign-in mail spent with it.
            LoginLink::spendAll($user->id, 'login');
            if ($user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }

            return $user;
        });
        if ($user === null) {
            self::evenOut($started);
            // An address with no account, an expired code, a wrong one: one answer for all.
            throw new ClientSafe(400, 'that code is wrong — check the email and try again');
        }
        RateLimiter::clear(self::codeKey($email));
        Audit::record($request, 'login.code', ['user' => $user]);

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user, fresh: true));
    }

    /**
     * Holds a refusal until CODE_REFUSAL_MS have passed: an address with an account and a mail
     * waiting costs a locked read and a write, one with neither a single read, and the difference
     * must not be what tells them apart.
     */
    private static function evenOut(int $started): void
    {
        $left = self::CODE_REFUSAL_MS * 1000 - intdiv(hrtime(true) - $started, 1000);
        if ($left > 0 && ! app()->runningUnitTests()) {
            usleep($left);
        }
    }

    private static function codeKey(string $email): string
    {
        return 'login-code:email:'.hash('sha256', $email);
    }

    public function redeem(Request $request): JsonResponse
    {
        $token = Input::jsString($request, 't');
        try {
            $result = $this->redeemLocked($token);
        } catch (UniqueConstraintViolationException) {
            // Two accounts confirming one address at once: the index decided, the second is told.
            throw new ClientSafe(409, 'that email address is already used by another account');
        }

        return $this->finish($request, $result);
    }

    /** @return array{string, User, ?string} the link's purpose, the account, the old address */
    private function redeemLocked(string $token): array
    {
        return DB::transaction(function () use ($token): array {
            $link = $token === '' ? null : LoginLink::query()->where('token_hash', LoginLink::hash($token))->lockForUpdate()->first();
            if ($link === null || $link->expires_at->isPast()) {
                // An unknown token reads as an expired one: there is nothing more to say about it.
                throw new ClientSafe(400, 'this sign-in link has expired — request a new one');
            }
            if ($link->used_at !== null) {
                throw new ClientSafe(400, 'this sign-in link was already used');
            }
            $user = User::query()->whereKey($link->user_id)->lockForUpdate()->first();
            if ($user === null || ! self::mayUseEmail($user)) {
                throw new ClientSafe(400, 'this sign-in link has expired — request a new one');
            }
            if ($user->disabled) {
                throw new ClientSafe(403, 'this account has been disabled');
            }
            $link->forceFill(['used_at' => now()])->save();
            if ($link->purpose === 'email') {
                // Still the address they asked for, and nobody else's by now.
                if ($user->pending_email === null || $user->pending_email !== $link->email) {
                    throw new ClientSafe(400, 'this sign-in link has expired — request a new one');
                }
                self::refuseTaken($link->email, $user->id);
                $old = $user->email;
                $user->forceFill(['email' => $link->email, 'pending_email' => null, 'email_verified_at' => now()])->save();
                // Whatever went to the old address before the change stops working now.
                LoginLink::spendAll($user->id);

                return ['email', $user, $old];
            }
            // One sign-in link used: the others mailed meanwhile are spent with it.
            LoginLink::spendAll($user->id, 'login');
            if ($user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }

            return ['login', $user, null];
        });
    }

    private function finish(Request $request, array $result): JsonResponse
    {
        [$purpose, $user, $old] = $result;

        if ($purpose === 'email') {
            Audit::record($request, 'account.email', ['user' => $user]);
            if (is_string($old) && $old !== '' && $old !== $user->email) {
                SendAfterResponse::to($old, new AccountMail('changed', $user, null, $user->email));
            }

            return Json::ok(['ok' => true, 'email' => $user->email]);
        }
        Audit::record($request, 'login.link', ['user' => $user]);

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user, fresh: true));
    }

    /**
     * GET /api/account → {email, pendingEmail, verified}: the caller's own address only. A new
     * self-serve coach has no email yet, just the pending one their first link confirms.
     */
    public function account(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user('api');

        return Json::ok([
            'email' => $user->email ?: null,
            'pendingEmail' => $user->pending_email ?: null,
            'verified' => $user->email_verified_at !== null && (bool) $user->email,
        ]);
    }

    public function changeEmail(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user('api');
        if (! $user->isCoach()) {
            return Json::error(403, 'forbidden');
        }
        $email = LoginLink::normaliseEmail(Input::jsString($request, 'email'));
        if (! LoginLink::validEmail($email)) {
            return Json::error(400, 'that is not an email address');
        }
        if ($email === LoginLink::normaliseEmail((string) $user->email)) {
            return Json::error(400, 'that is already your sign-in email');
        }
        // A new address is a write that outlives the session, so it needs one that signed in just
        // now (RequireFreshAuth's rule). The address already pending is not new: sending its link
        // again changes nothing a stolen session could use, and is how a coach whose first mail
        // went missing gets one — a day after signing up, when no session is fresh any more.
        $resend = $email === LoginLink::normaliseEmail((string) $user->pending_email);
        if (! $resend && ! FreshAuth::check($request)) {
            return Json::error(403, 'sign in again to do this — it needs a recent sign-in');
        }
        // Whether another account has this address is not said here — that would make this a
        // way to look addresses up. The confirmation goes out either way; opening it, which only
        // the inbox's holder can, is where a taken address is refused (redeem).
        $key = 'account-email:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, self::PER_EMAIL[0])) {
            return Json::error(429, 'too many emails asked for — try again in a few minutes');
        }
        RateLimiter::hit($key, self::PER_EMAIL[1]);
        $token = DB::transaction(function () use ($user, $email, $request): string {
            $me = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $me->forceFill(['pending_email' => $email])->save();
            // A newer change replaces the older one: its link is spent (the pending address moved).
            LoginLink::spendAll($me->id, 'email');
            [$token] = LoginLink::issue($me, 'email', $email, ClientIp::for($request, (string) config('fitpal.audit.ip')));

            return $token;
        });
        SendAfterResponse::to($email, new AccountMail('confirm', $user, LoginLink::url($token), $email));

        return Json::ok(['ok' => true, 'pendingEmail' => $email]);
    }

    /**
     * The account whose sign-in address this is, if it may sign in with it. Addresses are stored
     * normalised and `users.email` is unique, so this is the index, not a scan.
     */
    private static function accountWithEmail(string $email): ?User
    {
        $user = User::query()->where('email', $email)->where('disabled', false)->first();

        return $user !== null && self::mayUseEmail($user) ? $user : null;
    }

    /**
     * A coach or admin, as before; and a client whose address was proven (CHW-331), which today
     * means a join request accepted: the code they typed then. A client's account is then as safe
     * as their inbox (SECURITY.md).
     */
    private static function mayUseEmail(User $user): bool
    {
        return $user->isCoach() || $user->email_verified_at !== null;
    }

    /**
     * An address another account signs in with is not free. A pending one is not counted: an
     * address someone asked for and never confirmed must not block its real owner — whoever
     * confirms first has it, and the other is refused here at redeem.
     */
    private static function refuseTaken(string $email, string $self): void
    {
        $taken = User::query()->whereKeyNot($self)->where('email', $email)->exists();
        if ($taken) {
            throw new ClientSafe(409, 'that email address is already used by another account');
        }
    }
}
