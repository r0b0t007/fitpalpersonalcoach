<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Audit\ClientIp;
use App\Auth\SessionToken;
use App\Coaching\Referrals;
use App\Coaching\Terms;
use App\Domain\Plans;
use App\Mail\MailCopy;
use App\Mail\SendAfterResponse;
use App\Mail\SignupCodeMail;
use App\Models\CoachSignup;
use App\Models\LoginLink;
use App\Models\User;
use App\Support\ClientLimit;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

use function Illuminate\Support\defer;

/**
 * A coach signing up with an emailed code (CHW-368), beside the passkey sign-up (AuthController
 * coachOptions): fitpal.ma sends every "Start free" to /#/start, and the coaches it is for tap it
 * inside Instagram's browser, where a passkey fails or is lost. The passkey is offered afterwards,
 * outside such a browser, as it is to a client (AddPasskeySheet).
 *
 *  - POST /api/coach/signup/start {name, email, lang, terms} → {ok}: the same gates as the passkey
 *    sign-up (Plans::selfServeOpen, a real address, ClientLimit `register-coach`), then a code to
 *    the address. One sign-up per address: starting again replaces the code. Whether the address
 *    has an account is not said here — that would look it up for anyone.
 *  - POST /api/coach/signup/verify {email, code} → {user} and a session: the code proves the
 *    address, so the account has it at once (no `pending_email`, no confirmation mail). An address
 *    another account signs in with is refused here, once its inbox has been proven.
 */
final class CoachSignupController
{
    /** As the sign-in link: 3 codes per address per 15 minutes, and generous per connection. */
    private const PER_EMAIL = [3, 900];

    private const PER_PEER = [300, 3600];

    /** Tries per client address an hour, across addresses (LoginLinkController::CODE_PER_IP). */
    private const CODE_PER_IP = [60, 3600];

    public function start(Request $request): JsonResponse
    {
        // As the passkey sign-up reads it (AuthController::registerOptions).
        $name = Js::slice(Js::trim(Input::jsString($request, 'name')), 40);
        if ($name === '') {
            return Json::error(400, 'name required');
        }
        if (! Plans::selfServeOpen()) {
            Audit::record($request, 'auth.register.denied', ['ok' => false, 'name' => $name, 'msg' => 'self-serve-closed']);

            return Json::error(403, 'coach sign-up is not open on this server');
        }
        $email = LoginLink::normaliseEmail(Input::jsString($request, 'email'));
        if (! LoginLink::validEmail($email)) {
            return Json::error(400, 'that is not an email address');
        }
        // One budget with the passkey sign-up: a second way in is not a second hour's worth.
        if (ClientLimit::over($request, 'register-coach', 10, 100, 3600)) {
            Audit::record($request, 'auth.register.denied', ['ok' => false, 'name' => $name, 'msg' => 'self-serve-throttled']);

            return Json::error(429, 'too many sign-ups from here — try again later');
        }
        // Per address, answered alike: the code already in the inbox keeps working, as only a
        // mail sent replaces it.
        $buckets = [
            'signup-code:email:'.hash('sha256', $email) => self::PER_EMAIL,
            'signup-code:peer:'.$request->server('REMOTE_ADDR') => self::PER_PEER,
        ];
        foreach ($buckets as $key => [$max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return Json::ok(['ok' => true]);
            }
        }
        foreach ($buckets as $key => [, $decay]) {
            RateLimiter::hit($key, $decay);
        }

        $code = str_pad((string) random_int(0, 999_999), 6, '0', STR_PAD_LEFT);
        $now = Js::nowMs();
        $lang = Input::jsString($request, 'lang');
        $lang = in_array($lang, MailCopy::LANGS, true) ? $lang : null;
        CoachSignup::query()->updateOrCreate(['email' => $email], [
            'name' => $name, 'lang' => $lang,
            // The coach terms the page showed (CHW-357), kept only if they are the current ones, as
            // the passkey sign-up keeps them: the app asks for the current terms otherwise.
            'terms' => Input::jsString($request, 'terms') === Terms::VERSION ? Terms::VERSION : null,
            // The coach whose link this came through (CHW-350), checked when the code is verified.
            'ref' => Referrals::normaliseRef(Input::jsString($request, 'ref')),
            'code_hash' => CoachSignup::hash($email, $code), 'attempts' => 0,
            'code_expires' => $now + CoachSignup::CODE_MINUTES * 60_000, 'created' => $now,
        ]);
        defer(fn () => SendAfterResponse::send($email, new SignupCodeMail($code, $lang)));

        return Json::ok(['ok' => true]);
    }

    public function verify(Request $request): JsonResponse
    {
        $email = LoginLink::normaliseEmail(Input::jsString($request, 'email'));
        $code = Input::jsString($request, 'code');
        $ip = ClientIp::for($request, 'full') ?? (string) $request->ip();
        if (RateLimiter::hit('signup-code:ip:'.$ip, self::CODE_PER_IP[1]) > self::CODE_PER_IP[0]) {
            throw new ClientSafe(429, 'too many tries — request a new code');
        }
        // Decided under the row's lock and committed whatever the answer: a wrong code must count.
        // So a refusal is returned from the transaction and thrown after it.
        try {
            [$refusal, $user, $terms] = DB::transaction(function () use ($email, $code): array {
                $signup = CoachSignup::query()->whereKey($email)->lockForUpdate()->first();
                if ($signup === null || $signup->code_expires < Js::nowMs()) {
                    return [new ClientSafe(400, 'that code has expired — ask for a new one'), null, null];
                }
                if ($signup->attempts >= CoachSignup::MAX_ATTEMPTS) {
                    return [new ClientSafe(429, 'too many tries — request a new code'), null, null];
                }
                if (preg_match('/^\d{6}$/', $code) !== 1 || ! hash_equals($signup->code_hash, CoachSignup::hash($email, $code))) {
                    $signup->forceFill(['attempts' => $signup->attempts + 1])->save();

                    return [new ClientSafe(400, 'that code is wrong — check the email and try again'), null, null];
                }
                // Closed since the code was sent: the code is kept, and works if it opens again.
                if (! Plans::selfServeOpen()) {
                    return [new ClientSafe(403, 'coach sign-up is not open on this server'), null, null];
                }
                $signup->delete();
                // An account signs in with this address already: said now, to its inbox's holder only.
                // A pending address is nobody's: whoever proves it first has it (as at redeem).
                if (User::query()->where('email', $email)->exists()) {
                    return [new ClientSafe(409, 'that email address is already used by another account'), null, null];
                }
                $user = new User(['id' => User::newId(), 'name' => $signup->name]);
                $user->forceFill(['coach' => true, 'self_serve' => true, 'email' => $email, 'email_verified_at' => now(),
                    // Who referred them (CHW-350): only a coach still coaching, never their own address.
                    'referred_by' => Referrals::referrerFor($signup->ref, $email)?->id]
                    + ($signup->terms === Terms::VERSION ? ['terms_version' => $signup->terms, 'terms_at' => Js::nowMs()] : []))->save();

                return [null, $user, $signup->terms === Terms::VERSION ? $signup->terms : null];
            });
        } catch (UniqueConstraintViolationException) {
            // Two sign-ups proving one address at once: the index decided, the second is told.
            throw new ClientSafe(409, 'that email address is already used by another account');
        }
        if ($refusal !== null) {
            if ($refusal->status === 403) {
                Audit::record($request, 'auth.register.fail', ['ok' => false, 'msg' => 'self-serve-closed']);
            }
            throw $refusal;
        }
        RateLimiter::clear('signup-code:email:'.hash('sha256', $email));
        Audit::record($request, 'auth.register.ok', ['user' => $user, 'msg' => 'self-serve-code']);
        // The same evidence as accepting in the app: who, which version, when.
        if ($terms !== null) {
            Audit::record($request, 'coach.terms.accept', ['user' => $user, 'msg' => $terms]);
        }

        if ($user->referred_by !== null) {
            Audit::record($request, 'coach.referral.signup', ['user' => $user, 'target' => User::query()->find($user->referred_by)]);
        }

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user, fresh: true));
    }
}
