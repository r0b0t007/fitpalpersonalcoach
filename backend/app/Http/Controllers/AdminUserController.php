<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\MemberCard;
use App\Models\Assignment;
use App\Models\Presence;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Tenancy\CoachLock;
use App\Tenancy\Detach;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The owner's account controls (api/server.js GET /api/admin/users, GET /api/admin/user, POST
 * /api/admin/user/disable, /coach, /assign-coach). Behind RequireAdmin, with no CoachContext: the
 * admin acts on every account. Granting the coach role and pointing a member at a coach are
 * admin-only — the whole point of the role is that a coach cannot widen their own reach.
 *
 * Every write locks the rows it reads (as release and the send do), and retries a deadlock: a
 * detach touches the coach's whole roster, and a send to that roster locks the same rows.
 */
final class AdminUserController
{
    private const ATTEMPTS = 3;

    /** One row per account, in Node's order; each state is read on its own, as Node did. */
    public function index(): JsonResponse
    {
        $withPush = PushSubscription::query()->distinct()->pluck('user_id')->flip();
        $live = Presence::liveMap();
        $users = User::query()->signupOrder()->get()->map(function (User $u) use ($withPush, $live): array {
            return self::identity($u) + MemberCard::activity(MemberCard::state($u->id), $live[$u->id] ?? null) + ['hasPush' => $withPush->has($u->id)];
        });

        return Json::ok(['users' => $users->all(), 'invite_only' => (bool) config('fitpal.invite_only'), 'now' => Audit::now()]);
    }

    /** Drill-down: one account's workouts, newest first, and body-weight log. */
    public function show(Request $request): JsonResponse
    {
        $id = Input::searchParam($request, 'id');
        $u = is_string($id) ? User::query()->find($id) : null;
        if (! $u) {
            return Json::error(404, 'no such user');
        }
        $s = MemberCard::state($u->id);

        return Json::ok([
            'user' => self::identity($u) + ['ownCoachFlag' => (bool) $u->coach],
        ] + MemberCard::drillDown($s) + [
            'workouts' => array_reverse(Js::list($s->workouts ?? null)),
        ]);
    }

    public function disable(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        $disabled = Js::truthy(Input::raw($request, 'disabled'));
        $u = DB::transaction(function () use ($id, $disabled): User {
            $u = self::locked($id);
            if ($u->isAdmin()) {
                throw new ClientSafe(400, 'cannot disable an admin');
            }
            $u->forceFill(['disabled' => $disabled])->save();
            // Disabling a coach does what revoking the role does. It used to lock the account and
            // stop there: their members still pointed at them, their offers stayed acceptable, and
            // the admin dropdown — which leaves disabled coaches out — showed those members as
            // having no coach while they still had one.
            if ($disabled) {
                Presence::drop($u->id);   // off "training now" at once
            }
            if ($disabled && $u->isCoach()) {
                Detach::coach($u);
            }

            return $u;
        }, self::ATTEMPTS);
        Audit::record($request, $u->disabled ? 'admin.user.disable' : 'admin.user.enable', ['user' => $request->user('api'), 'target' => $u]);

        return Json::ok(['ok' => true, 'id' => $u->id, 'disabled' => (bool) $u->disabled]);
    }

    public function coach(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        $coach = Js::truthy(Input::raw($request, 'coach'));
        $u = DB::transaction(function () use ($id, $coach): User {
            $u = self::locked($id);
            $u->forceFill(['coach' => $coach])->save();
            // An admin is still a coach with the flag off: nothing is detached, their roster and
            // offers stay valid because they never lost the ability to coach.
            if (! $coach && ! $u->isCoach()) {
                Detach::coach($u);
            }

            return $u;
        }, self::ATTEMPTS);

        return Json::ok(['ok' => true, 'id' => $u->id, 'coach' => (bool) $u->coach]);
    }

    public function assignCoach(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        $coachId = Js::trim(Input::jsString($request, 'coachId'));

        return DB::transaction(function () use ($id, $coachId): JsonResponse {
            // The coach's row first (CoachLock), then the member's: a coach disabled in the meantime
            // is seen as disabled, and a send to this member waits until the move is done.
            $c = $coachId === '' ? null : CoachLock::take($coachId);
            $u = self::locked($id);
            $previous = $u->coach_id;
            if ($coachId === '') {
                $u->forceFill(['coach_id' => null])->save();
                Assignment::expirePending($u->id, $previous);

                return Json::ok(['ok' => true, 'id' => $u->id, 'coachId' => null]);
            }
            if (! $c || ! $c->isCoach()) {
                throw new ClientSafe(400, 'that user is not a coach');
            }
            // The dropdown leaves disabled coaches out of a list taken when the sheet opened, so
            // one disabled in the meantime is still selectable.
            if ($c->disabled) {
                throw new ClientSafe(400, 'that coach is disabled');
            }
            if ($c->id === $u->id) {
                throw new ClientSafe(400, 'a member cannot be their own coach');
            }
            $u->forceFill(['coach_id' => $c->id])->save();
            // Offers from whoever had them before are no longer this coach's to stand behind.
            if ($previous !== null && $previous !== $c->id) {
                Assignment::expirePending($u->id, $previous);
            }

            return Json::ok(['ok' => true, 'id' => $u->id, 'coachId' => $c->id]);
        }, self::ATTEMPTS);
    }

    /** Who an account is, as both the list and the drill-down show it. */
    private static function identity(User $u): array
    {
        return [
            'id' => $u->id, 'name' => $u->name, 'created' => $u->createdIso(), 'disabled' => (bool) $u->disabled,
            'admin' => $u->isAdmin(), 'invitedBy' => Js::or($u->invited_by, null),
            'coach' => $u->isCoach(), 'coachId' => Js::or($u->coach_id, null),
        ];
    }

    /** `db.users.find(x => x.id === body.id)`, locked: only a string can match. */
    private static function locked(mixed $id): User
    {
        $u = is_string($id) ? User::query()->whereKey($id)->lockForUpdate()->first() : null;

        return $u ?? throw new ClientSafe(404, 'no such user');
    }
}
