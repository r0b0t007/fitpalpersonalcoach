<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Audit\ClientIp;
use App\Auth\SessionToken;
use App\Coaching\Handle;
use App\Coaching\Intake;
use App\Jobs\SendPush;
use App\Mail\AccountMail;
use App\Mail\JoinCodeMail;
use App\Mail\MailCopy;
use App\Mail\SendAfterResponse;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\LoginLink;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Tenancy\CoachLock;
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
        // The honeypot is a field people never see, named so no autofill thinks it knows it; the
        // fill time is the form's own count (and the form waits it out, lib/join.js).
        $elapsed = Input::raw($request, 'elapsed');
        if (Input::jsString($request, 'hp') !== '' || ! is_int($elapsed) || $elapsed < self::MIN_FILL_MS) {
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

        // One unverified request per address and coach: starting again (the form's "send the code
        // again") reuses it, so its id holds — a resend that was throttled leaves the code already
        // in the inbox working against the id the page has. Only the newest code works.
        $code = str_pad((string) random_int(0, 999_999), 6, '0', STR_PAD_LEFT);
        $now = Js::nowMs();
        $join = JoinRequest::queueOf($coach)->where('email', $email)->where('status', 'unverified')->first()
            ?? (new JoinRequest)->forceFill(['id' => JoinRequest::newId(), 'coach_id' => $coach->id, 'email' => $email, 'status' => 'unverified']);
        $lang = Input::jsString($request, 'lang');
        $join->forceFill([
            'name' => $name, 'lang' => in_array($lang, MailCopy::LANGS, true) ? $lang : null, 'intake' => Js::stringify($intake),
            'code_hash' => JoinRequest::hash($code), 'attempts' => 0, 'code_expires' => $now + JoinRequest::CODE_MINUTES * 60_000,
            'created' => $now,
        ])->save();
        // The page, not the address: a log of what strangers typed is a liability.
        Audit::record($request, 'join.request', ['ok' => true, 'msg' => $page->handle]);
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
        [$refusal, $join, $token, $coach] = array_pad(DB::transaction(function () use ($id, $code): array {
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
            // The coach judged again, on their locked row, at the moment the request would wait on
            // them: the page may have closed or the coach gone since the code was sent, and the
            // queue's cap is counted here too — under the lock, so two codes cannot both take the
            // last place.
            $coach = CoachLock::take($join->coach_id);
            $page = CoachPage::acrossCoaches()->find($join->coach_id); // across coaches: the page of the request's coach
            if ($coach === null || $coach->disabled || ! $coach->isCoach() || $page === null || ! $page->open) {
                $join->delete();

                return [new ClientSafe(404, 'this coach is not taking requests right now'), null, null];
            }
            if ($coach->email !== null && LoginLink::normaliseEmail($coach->email) === $join->email) {
                $join->delete();

                return [new ClientSafe(400, 'that is your own page'), null, null];
            }
            // Already waiting, or already their client. Not "once accepted": a client released
            // since may ask again.
            if (JoinRequest::queueOf($coach)->where('email', $join->email)->where('status', 'pending')->exists()
                || User::clientsOf($coach)->where('email', $join->email)->exists()) {
                $join->delete();

                return [new ClientSafe(409, 'you already asked to join this coach'), null, null];
            }
            if (JoinRequest::queueOf($coach)->where('status', 'pending')->count() >= JoinRequest::MAX_PENDING) {
                return [new ClientSafe(429, 'this coach has too many requests waiting — try again later'), null, null];
            }
            $token = bin2hex(random_bytes(32));
            $join->forceFill(['status' => 'pending', 'code_hash' => null, 'token_hash' => JoinRequest::hash($token)])->save();

            return [null, $join, $token, $coach];
        }), 4, null);
        if ($refusal !== null) {
            throw $refusal;
        }
        Audit::record($request, 'join.verify', ['ok' => true, 'msg' => CoachPage::acrossCoaches()->find($join->coach_id)?->handle]); // across coaches: the page of the request's coach, for the log
        self::tellCoach($join, $coach);

        return Json::ok(['ok' => true, 'token' => $token, 'status' => $join->status]);
    }

    /**
     * A request now waits on its coach (CHW-337): a push to their devices, with the name the
     * follower gave, and a mail without it — the mail goes further than the coach's own screen, and
     * the name is text a stranger typed. Only to an address the coach has proven. Both after the
     * response, both best-effort: the request is in the inbox whatever they do.
     */
    private static function tellCoach(JoinRequest $join, User $coach): void
    {
        SendPush::dispatch($coach->id, 'join-request', [$join->name]);
        if ($coach->email !== null && $coach->email_verified_at !== null) {
            SendAfterResponse::to($coach->email, new AccountMail('request', $coach, rtrim((string) config('fitpal.origin'), '/').'/#/requests'));
        }
    }

    /**
     * POST /api/join/claim {id, token} → {user} with a session: once the coach has accepted, the
     * browser that sent the request is signed in to the account accept made. Not spent on the first
     * claim — a claim whose answer the network lost can be made again — but only for CLAIM_DAYS after
     * the accept, after which prune forgets the token. Anywhere else, the follower signs in as any
     * client does.
     */
    public function claim(Request $request): JsonResponse
    {
        $id = Input::jsString($request, 'id');
        $token = Input::jsString($request, 'token');
        $user = DB::transaction(function () use ($id, $token): ?User {
            $join = $id === '' ? null : JoinRequest::acrossCoaches()->whereKey($id)->lockForUpdate()->first(); // across coaches: a public route finds a request by its id
            if ($join === null || $join->status !== 'accepted' || $join->token_hash === null || ! hash_equals($join->token_hash, JoinRequest::hash($token))
                || $join->decided < Js::nowMs() - JoinRequest::CLAIM_DAYS * 86_400_000) {
                return null;
            }
            // Still that coach's client, and still allowed in: a release or a disable since the
            // accept leaves nothing to sign in to here.
            $user = User::query()->where('email', $join->email)->first();
            if ($user === null || $user->disabled || $user->coach_id !== $join->coach_id) {
                return null;
            }

            return $user;
        });
        if ($user === null) {
            throw new ClientSafe(404, 'no such request');
        }
        Audit::record($request, 'join.claim', ['user' => $user]);

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user, fresh: true));
    }

    /**
     * POST /api/join/status {id, token} → {status, coachName, handle, theme}: for the browser
     * holding the token, and nobody else. A POST so the token never sits in a URL, where access
     * logs keep it — it is what signs the follower in once accepted (CHW-337). Answers whether or
     * not the page is still open: a request in flight is still the follower's to see.
     */
    public function status(Request $request): JsonResponse
    {
        $id = Input::jsString($request, 'id');
        $token = Input::jsString($request, 'token');
        $join = $id === '' ? null : JoinRequest::acrossCoaches()->find($id); // across coaches: a public route finds a request by its id
        if ($join === null || $join->token_hash === null || ! hash_equals($join->token_hash, JoinRequest::hash($token))) {
            throw new ClientSafe(404, 'no such request');
        }
        $page = CoachPage::acrossCoaches()->find($join->coach_id); // across coaches: the page of the request's coach

        return Json::ok([
            'status' => $join->status,
            'coachName' => User::query()->find($join->coach_id)?->name,
            'handle' => $page?->handle,
            'theme' => $page?->theme ?? 'dark',
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
