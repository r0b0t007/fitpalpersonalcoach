<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Domain\Entitlement;
use App\Models\JoinRequest;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use App\Tenancy\CoachLock;
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

    public function decide(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $id = Input::jsString($request, 'id');
        $accept = Input::raw($request, 'accept') === true;
        try {
            // A refusal is returned from the transaction and thrown after it: a request that lapses
            // because its follower found another coach must stay lapsed.
            [$refusal, $member, $join] = DB::transaction(function () use ($coach, $id, $accept): array {
                $join = $id === '' ? null : JoinRequest::query()->whereKey($id)->lockForUpdate()->first();
                if ($join === null || $join->status !== 'pending') {
                    return [new ClientSafe(404, 'no such request'), null, null];
                }
                $now = Js::nowMs();
                if (! $accept) {
                    $join->forceFill(['status' => 'declined', 'decided' => $now])->save();

                    return [null, null, $join];
                }
                $user = User::query()->where('email', $join->email)->lockForUpdate()->first();
                // Another coach's client (a follower who asked two coaches), a coach, or an account
                // switched off: nothing to put on this roster, and nothing to wait for.
                if ($user !== null && ($user->coach_id !== null || $user->isCoach() || $user->disabled)) {
                    $join->forceFill(['status' => 'expired', 'decided' => $now])->save();

                    return [new ClientSafe(409, 'they already train with another coach'), null, null];
                }
                // Counted on the coach's locked row: two accepts cannot both take the last seat.
                $entitlement = Entitlement::for(CoachLock::take($coach->id), lock: true);
                if (! $entitlement->canTakeClient) {
                    return [new ClientSafe(402, Say::f('your plan allows {0} clients — upgrade to accept more', $entitlement->cap)), null, null];
                }
                $user ??= (new User)->forceFill(['id' => User::newId(), 'name' => $join->name, 'email' => $join->email]);
                // The address is proven: the follower typed the code it received.
                $user->forceFill(['coach_id' => $coach->id, 'email_verified_at' => $user->email_verified_at ?? now()])->save();
                $join->forceFill(['status' => 'accepted', 'decided' => $now])->save();

                return [null, $user, $join];
            });
        } catch (UniqueConstraintViolationException) {
            // Two coaches accepting one follower at once: the address is unique, the first one has them.
            throw new ClientSafe(409, 'they already train with another coach');
        }
        if ($refusal !== null) {
            throw $refusal;
        }
        Audit::record($request, $accept ? 'coach.request.accept' : 'coach.request.decline', ['user' => $coach, 'msg' => $accept ? $member->id : $join->id]);

        return Json::ok(['requests' => self::list(), 'member' => $member ? ['id' => $member->id, 'name' => $member->name] : null]);
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
