<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Domain\Entitlement;
use App\Mail\JoinAnswerMail;
use App\Mail\SendAfterResponse;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use App\Tenancy\CoachLock;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * A coach's requests inbox (CHW-337, spec §3, §3.0): the followers who asked to train with them
 * from their page (CHW-336), and the answer. Runs in the coach's CoachContext, so JoinRequest is
 * their own queue: another coach's request is simply "no such request".
 *
 * Accept is the first moment the follower has an account: made here, on this coach's roster, with
 * the address the code proved — or an account that already had that address and no coach, bound.
 * Behind the seat check, under the coach's lock, as every way onto a roster is (InviteController::
 * redeem): the request row first, then the follower's, then the coach's. A follower already with a
 * coach is never moved — their request lapses instead.
 */
final class CoachRequestController
{
    /** Decided requests shown under the waiting ones. */
    private const RECENT = 50;

    public function index(): JsonResponse
    {
        return Json::ok(['requests' => self::list()]);
    }

    /** GET /api/coach/requests/count → {pending}: Today's card, without sending anyone's intake. */
    public function count(): JsonResponse
    {
        return Json::ok(['pending' => JoinRequest::query()->where('status', 'pending')->count()]);
    }

    public function decide(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $id = Input::jsString($request, 'id');
        // A yes or a no, and nothing else: a decline cannot be taken back, so a missing or garbled
        // answer must not read as one.
        $accept = Input::raw($request, 'accept');
        if (! is_bool($accept)) {
            throw new ClientSafe(400, 'accept must be true or false');
        }
        try {
            // A refusal is returned from the transaction and thrown after it: a request that lapses
            // because its follower found another coach must stay lapsed.
            [$refusal, $member, $join] = DB::transaction(fn (): array => self::decideLocked($coach, $id, $accept));
        } catch (UniqueConstraintViolationException) {
            // Two coaches accepting one follower at once: the address is unique, the first one has them.
            throw new ClientSafe(409, 'they already train with another coach');
        } catch (QueryException $e) {
            // The same race seen by MariaDB as a deadlock or a lock wait: one accept won it, and this
            // one is the 409 it would otherwise have been.
            if (in_array($e->errorInfo[1] ?? null, [1213, 1205], true) || ($e->errorInfo[0] ?? null) === '40001') {
                throw new ClientSafe(409, 'they already train with another coach');
            }
            throw $e;
        }
        if ($refusal !== null) {
            throw $refusal;
        }
        Audit::record($request, $accept ? 'coach.request.accept' : 'coach.request.decline', ['user' => $coach, 'msg' => $accept ? $member->id : $join->id]);
        self::tellFollower($join, $coach, $accept);

        return Json::ok(['requests' => self::list(), 'member' => $member ? ['id' => $member->id, 'name' => $member->name] : null]);
    }

    /** @return array{0: ClientSafe|null, 1: User|null, 2: JoinRequest|null} */
    private static function decideLocked(User $coach, string $id, bool $accept): array
    {
        $join = $id === '' ? null : JoinRequest::query()->whereKey($id)->lockForUpdate()->first();
        if ($join === null || $join->status !== 'pending') {
            return [new ClientSafe(404, 'no such request'), null, null];
        }
        $now = Js::nowMs();
        if (! $accept) {
            $join->forceFill(['status' => 'declined', 'decided' => $now])->save();

            return [null, null, $join];
        }
        // Read, then locked by its key only when it exists: a locking read of a row that is not
        // there takes a gap lock on MariaDB, and two accepts of one new address would deadlock.
        $found = User::query()->where('email', $join->email)->value('id');
        $user = $found !== null ? User::query()->whereKey($found)->lockForUpdate()->first() : null;
        $lapse = function (ClientSafe $why) use ($join, $now): array {
            $join->forceFill(['status' => 'expired', 'decided' => $now])->save();

            return [$why, null, null];
        };
        if ($user !== null && $user->coach_id === $coach->id) {
            // Already on this roster (an invite link, say): the request is answered by that.
            $join->forceFill(['status' => 'accepted', 'decided' => $now])->save();

            return [null, $user, $join];
        }
        if ($user?->disabled) {
            return $lapse(new ClientSafe(409, 'this account has been disabled'));
        }
        if ($user?->isCoach()) {
            return $lapse(new ClientSafe(409, 'that address belongs to a coach account'));
        }
        if ($user !== null && $user->coach_id !== null) {
            // A follower who asked two coaches: never moved from the one who accepted first.
            return $lapse(new ClientSafe(409, 'they already train with another coach'));
        }
        // The coach judged again on their locked row (a detach holds this lock while it lets a coach
        // go), and the seat counted on it: two accepts cannot both take the last seat.
        $me = CoachLock::take($coach->id);
        if (! $me || $me->disabled) {
            return [new ClientSafe(401, 'not signed in'), null, null];
        }
        if (! $me->isCoach()) {
            return [new ClientSafe(403, 'forbidden'), null, null];
        }
        $entitlement = Entitlement::for($me, lock: true);
        if (! $entitlement->canTakeClient) {
            return [new ClientSafe(402, Say::f('your plan allows {0} clients — upgrade to accept more', (int) $entitlement->cap)), null, null];
        }
        $user ??= (new User)->forceFill(['id' => User::newId(), 'name' => $join->name, 'email' => $join->email]);
        // The address is proven: the follower typed the code it received.
        $user->forceFill(['coach_id' => $coach->id, 'email_verified_at' => $user->email_verified_at ?? now()])->save();
        $join->forceFill(['status' => 'accepted', 'decided' => $now])->save();

        return [null, $user, $join];
    }

    /**
     * The answer, mailed to the follower in the language of their form (CHW-337): accepted, with
     * the way back to the join page, where the browser that asked signs in; declined, nothing more.
     */
    private static function tellFollower(JoinRequest $join, User $coach, bool $accepted): void
    {
        $handle = CoachPage::query()->first()?->handle;
        $url = $handle !== null ? rtrim((string) config('fitpal.origin'), '/').'/#/join/'.$handle : null;
        SendAfterResponse::to($join->email, new JoinAnswerMail($accepted, (string) $coach->name, $join->lang, $url));
    }

    /** @return list<array<string, mixed>> the waiting requests, then the latest decided ones */
    private static function list(): array
    {
        return JoinRequest::query()->where('status', '!=', 'unverified')
            ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")->orderByDesc('created')
            ->limit(JoinRequest::MAX_PENDING + self::RECENT)->get()
            ->map(fn (JoinRequest $r) => [
                'id' => $r->id, 'name' => $r->name, 'email' => $r->email, 'status' => $r->status,
                'intake' => json_decode($r->intake, false) ?: new \stdClass, 'created' => $r->created, 'decided' => $r->decided,
            ])->all();
    }
}
