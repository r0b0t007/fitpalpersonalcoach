<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Audit\ClientIp;
use App\Coaching\Handle;
use App\Coaching\Intake;
use App\Mail\JoinCodeMail;
use App\Mail\SendAfterResponse;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\LoginLink;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

use function Illuminate\Support\defer;

/**
 * A follower asking to join a coach from their public page (CHW-336, spec §3, §3.0, §3.2). No
 * session and no account: the request is kept with its intake, the address is proven by a 6-digit
 * code, and the browser keeps a token to read the request's state. The coach accepts or declines
 * it (CHW-337); only acceptance makes an account (spec §3.0) — so on an INVITE_ONLY server a
 * form filled in by anyone leaves no user behind.
 *
 * Public, so it is guarded as the sign-in link is (LoginLinkController): three throttle buckets,
 * and a honeypot and a minimum fill time a person never trips. A bot, a throttled sender and a
 * person all get the same {ok, id} from start — only a real request is ever mailed or stored.
 */
final class JoinController
{
    /** As the sign-in link: 3 codes per address per 15 minutes, 10 per place per hour, generous per connection. */
    private const PER_EMAIL = [3, 900];

    private const PER_IP = [10, 3600];

    private const PER_PEER = [300, 3600];

    private const THROTTLE_AUDITS = 20;

    /** Faster than this, the form was not filled in by a person. */
    private const MIN_FILL_MS = 3000;

    private const NAME_MAX = 40;

    public function start(Request $request): JsonResponse
    {
        $decoy = fn () => Json::ok(['ok' => true, 'id' => JoinRequest::newId()]);
        // The honeypot is a field people never see; the fill time is the form's own count.
        $elapsed = Input::raw($request, 'elapsed');
        if (Input::jsString($request, 'website') !== '' || ! is_int($elapsed) || $elapsed < self::MIN_FILL_MS) {
            return $decoy();
        }

        [$page, $coach] = CoachPage::findPublic(Handle::normalise(Input::raw($request, 'handle')));
        if ($page === null || $coach === null) {
            throw new ClientSafe(404, 'no such coach page');
        }
        if (! $page->open) {
            throw new ClientSafe(404, 'this coach is not taking requests right now');
        }
        $name = trim(Input::jsString($request, 'name'));
        if ($name === '' || mb_strlen($name) > self::NAME_MAX) {
            throw new ClientSafe(400, 'tell us your name');
        }
        $email = LoginLink::normaliseEmail(Input::jsString($request, 'email'));
        if (! LoginLink::validEmail($email)) {
            throw new ClientSafe(400, 'that is not an email address');
        }
        $intake = Intake::from(Input::raw($request, 'intake'));

        if ($this->throttled($request, $email)) {
            return $decoy();
        }
        if (JoinRequest::queueOf($coach)->where('status', 'pending')->count() >= JoinRequest::MAX_PENDING) {
            throw new ClientSafe(429, 'this coach has too many requests waiting — try again later');
        }

        // One unverified request per address and coach: starting again replaces it.
        JoinRequest::queueOf($coach)->where('email', $email)->where('status', 'unverified')->delete();
        $code = str_pad((string) random_int(0, 999_999), 6, '0', STR_PAD_LEFT);
        $now = Js::nowMs();
        $join = (new JoinRequest)->forceFill([
            'id' => JoinRequest::newId(), 'coach_id' => $coach->id, 'email' => $email, 'name' => $name,
            'intake' => Js::stringify($intake), 'status' => 'unverified',
            'code_hash' => JoinRequest::hash($code), 'attempts' => 0, 'code_expires' => $now + JoinRequest::CODE_MINUTES * 60_000,
            'created' => $now,
        ]);
        $join->save();
        // The page, not the address: a log of what strangers typed is a liability.
        Audit::record($request, 'join.request', ['ok' => true, 'msg' => $page->handle]);
        $lang = Input::jsString($request, 'lang');
        defer(fn () => SendAfterResponse::send($email, new JoinCodeMail($code, (string) $coach->name, $lang)));

        return Json::ok(['ok' => true, 'id' => $join->id]);
    }

    /**
     * POST /api/join/verify {id, code} → {ok, token, status}: the code proves the address, and the
     * request waits for the coach. Still no account and no session (spec §3.0): the token is what
     * this browser keeps to read the request and, once accepted, to sign in (CHW-337).
     */
    public function verify(Request $request): JsonResponse
    {
        $id = Input::jsString($request, 'id');
        $code = Input::jsString($request, 'code');
        // Decided under the row's lock and committed, whatever the answer — a wrong code must count —
        // so a refusal is returned from the transaction and thrown after it.
        [$refusal, $join, $token] = DB::transaction(function () use ($id, $code): array {
            $join = $id === '' ? null : JoinRequest::acrossCoaches()->whereKey($id)->lockForUpdate()->first(); // across coaches: a public route finds a request by its id
            if ($join === null || $join->status !== 'unverified' || $join->code_expires < Js::nowMs()) {
                return [new ClientSafe(400, 'that code has expired — ask for a new one'), null, null];
            }
            if ($join->attempts >= JoinRequest::MAX_ATTEMPTS) {
                return [new ClientSafe(429, 'too many tries — request a new code'), null, null];
            }
            if (! hash_equals((string) $join->code_hash, JoinRequest::hash($code))) {
                $join->forceFill(['attempts' => $join->attempts + 1])->save();

                return [new ClientSafe(400, 'that code is wrong — check the email and try again'), null, null];
            }
            $coach = User::query()->find($join->coach_id);
            if ($coach !== null && $coach->email !== null && LoginLink::normaliseEmail($coach->email) === $join->email) {
                $join->delete();

                return [new ClientSafe(400, 'that is your own page'), null, null];
            }
            if (JoinRequest::queueOf($coach)->where('email', $join->email)->where('status', 'pending')->exists()) {
                $join->delete();

                return [new ClientSafe(409, 'you already asked to join this coach'), null, null];
            }
            $token = bin2hex(random_bytes(32));
            $join->forceFill(['status' => 'pending', 'code_hash' => null, 'token_hash' => JoinRequest::hash($token)])->save();

            return [null, $join, $token];
        });
        if ($refusal !== null) {
            throw $refusal;
        }
        Audit::record($request, 'join.verify', ['ok' => true, 'msg' => CoachPage::acrossCoaches()->find($join->coach_id)?->handle]); // across coaches: the page of the request's coach, for the log

        return Json::ok(['ok' => true, 'token' => $token, 'status' => $join->status]);
    }

    /** GET /api/join/status?id=&token= → {status, coachName, handle}: for the browser holding the token, and nobody else. */
    public function status(Request $request): JsonResponse
    {
        $id = (string) $request->query('id', '');
        $token = (string) $request->query('token', '');
        $join = $id === '' ? null : JoinRequest::acrossCoaches()->find($id); // across coaches: a public route finds a request by its id
        if ($join === null || $join->token_hash === null || ! hash_equals($join->token_hash, JoinRequest::hash($token))) {
            throw new ClientSafe(404, 'no such request');
        }

        return Json::ok([
            'status' => $join->status,
            'coachName' => User::query()->find($join->coach_id)?->name,
            'handle' => CoachPage::acrossCoaches()->find($join->coach_id)?->handle, // across coaches: the page of the request's coach
        ]);
    }

    /** As LoginLinkController::request: true when any bucket is full; counts the request otherwise. */
    private function throttled(Request $request, string $email): bool
    {
        $ip = ClientIp::for($request, 'full') ?? (string) $request->ip();
        $buckets = [
            'join:email:'.hash('sha256', $email) => self::PER_EMAIL,
            'join:ip:'.$ip => self::PER_IP,
            'join:peer:'.$request->server('REMOTE_ADDR') => self::PER_PEER,
        ];
        foreach ($buckets as $key => [$max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                RateLimiter::attempt('join:throttle-audit', self::THROTTLE_AUDITS,
                    fn () => Audit::record($request, 'join.request.throttled', ['ok' => false]), 3600);

                return true;
            }
        }
        foreach ($buckets as $key => [, $decay]) {
            RateLimiter::hit($key, $decay);
        }

        return false;
    }
}
