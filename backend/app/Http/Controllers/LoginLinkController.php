<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Auth\SessionToken;
use App\Mail\AccountMail;
use App\Mail\SendAfterResponse;
use App\Models\LoginLink;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

/**
 * A coach's second way in (spec §4a, R4; Laravel only): a sign-in link by email, and changing the
 * address those links go to. Passkeys stay the primary sign-in and the only one for clients.
 *
 *  - POST /api/login/email {email} always answers {ok: true} — unknown, a client's, a disabled
 *    account's, a pending address, throttled: all alike, so it cannot tell anyone whether an
 *    address has an account. A coach or admin whose `email` is that address gets a link.
 *  - POST /api/login/link {t} redeems either kind of link: a sign-in link signs in exactly as a
 *    passkey does (SessionToken::cookies, so `logout/all` ends it too); an email-change link moves
 *    the pending address into `email` and tells the old one.
 *  - POST /api/account/email {email} (signed in) only writes `pending_email` and mails the new
 *    address: a live session alone — a shared laptop, a paired phone — can never point the
 *    account's recovery at someone else's inbox.
 */
final class LoginLinkController
{
    /** 3 links per address per 15 minutes; 10 requests per IP per hour (spec §4a). */
    private const PER_EMAIL = [3, 900];

    private const PER_IP = [10, 3600];

    public function request(Request $request): JsonResponse
    {
        $email = self::normalise(Input::jsString($request, 'email'));
        $ip = (string) $request->ip();
        $emailKey = 'login-link:email:'.hash('sha256', $email);
        $ipKey = 'login-link:ip:'.$ip;
        if (RateLimiter::tooManyAttempts($emailKey, self::PER_EMAIL[0]) || RateLimiter::tooManyAttempts($ipKey, self::PER_IP[0])) {
            // The address is not recorded: a log of what strangers typed is a liability.
            Audit::record($request, 'login.link.throttled', ['ok' => false]);

            return Json::ok(['ok' => true]);
        }
        RateLimiter::hit($emailKey, self::PER_EMAIL[1]);
        RateLimiter::hit($ipKey, self::PER_IP[1]);

        $user = self::valid($email) ? self::coachWithEmail($email) : null;
        if ($user !== null) {
            [$token] = LoginLink::issue($user, 'login', null, $ip);
            SendAfterResponse::to($user->email, new AccountMail('signin', $user, self::url($token)));
        }

        return Json::ok(['ok' => true]);
    }

    public function redeem(Request $request): JsonResponse
    {
        $token = Input::jsString($request, 't');
        $result = DB::transaction(function () use ($token): array {
            $link = $token === '' ? null : LoginLink::query()->where('token_hash', LoginLink::hash($token))->lockForUpdate()->first();
            if ($link === null || $link->expires_at->isPast()) {
                // An unknown token reads as an expired one: there is nothing more to say about it.
                throw new ClientSafe(400, 'this sign-in link has expired — request a new one');
            }
            if ($link->used_at !== null) {
                throw new ClientSafe(400, 'this sign-in link was already used');
            }
            $user = User::query()->whereKey($link->user_id)->lockForUpdate()->first();
            if ($user === null || ! $user->isCoach()) {
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

                return ['email', $user, $old];
            }
            if ($user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }

            return ['login', $user, null];
        });
        [$purpose, $user, $old] = $result;

        if ($purpose === 'email') {
            Audit::record($request, 'account.email', ['user' => $user]);
            if (is_string($old) && $old !== '' && $old !== $user->email) {
                SendAfterResponse::to($old, new AccountMail('changed', $user, null, $user->email));
            }

            return Json::ok(['ok' => true, 'email' => $user->email]);
        }
        Audit::record($request, 'login.link', ['user' => $user]);

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user));
    }

    public function changeEmail(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user('api');
        if (! $user->isCoach()) {
            return Json::error(403, 'forbidden');
        }
        $email = self::normalise(Input::jsString($request, 'email'));
        if (! self::valid($email)) {
            return Json::error(400, 'that is not an email address');
        }
        if ($email === self::normalise((string) $user->email)) {
            return Json::error(400, 'that is already your sign-in email');
        }
        $key = 'account-email:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, self::PER_EMAIL[0])) {
            return Json::error(429, 'too many emails asked for — try again in a few minutes');
        }
        RateLimiter::hit($key, self::PER_EMAIL[1]);
        $token = DB::transaction(function () use ($user, $email, $request): string {
            $me = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            self::refuseTaken($email, $me->id);
            $me->forceFill(['pending_email' => $email])->save();
            [$token] = LoginLink::issue($me, 'email', $email, (string) $request->ip());

            return $token;
        });
        SendAfterResponse::to($email, new AccountMail('confirm', $user, self::url($token), $email));

        return Json::ok(['ok' => true, 'pendingEmail' => $email]);
    }

    /** The one coach (or admin) whose sign-in address this is; nobody when it is unclear. */
    private static function coachWithEmail(string $email): ?User
    {
        $found = User::query()->whereRaw('lower(email) = ?', [$email])->where('disabled', false)->limit(2)->get();

        return $found->count() === 1 && $found->first()->isCoach() ? $found->first() : null;
    }

    /** An address another account signs in with, or is about to, is not free. */
    private static function refuseTaken(string $email, string $self): void
    {
        $taken = User::query()->whereKeyNot($self)
            ->where(fn ($q) => $q->whereRaw('lower(email) = ?', [$email])->orWhereRaw('lower(pending_email) = ?', [$email]))
            ->exists();
        if ($taken) {
            throw new ClientSafe(409, 'that email address is already used by another account');
        }
    }

    private static function normalise(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    private static function valid(string $email): bool
    {
        return $email !== '' && strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }

    /** The app's link-landing screen (S6): the token in the hash, never sent to a server log. */
    private static function url(string $token): string
    {
        return config('fitpal.origin').'/#/link?t='.$token;
    }
}
