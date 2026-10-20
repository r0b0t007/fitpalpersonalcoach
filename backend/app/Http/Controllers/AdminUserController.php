<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\MemberCard;
use App\Models\Assignment;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
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
        $users = User::query()->signupOrder()->get()->map(function (User $u): array {
            $s = MemberCard::state($u->id);
            $workouts = Js::list($s->workouts ?? null);

            return [
                'id' => $u->id, 'name' => $u->name, 'created' => $u->createdIso(),
                'disabled' => (bool) $u->disabled, 'admin' => $u->isAdmin(), 'invitedBy' => Js::or($u->invited_by, null),
                'coach' => $u->isCoach(), 'coachId' => Js::or($u->coach_id, null),
                'workouts' => count($workouts),
            ] + MemberCard::lastWorkout($workouts) + [
                'lastSync' => Js::or($s->_ts ?? null, null),
                // Push subscriptions arrive with R3; until then nobody has one.
                'hasPush' => false,
                // The presence object while they train (R3 brings presence); null otherwise.
                'live' => null,
            ];
        });

        return Json::ok(['users' => $users->all(), 'invite_only' => (bool) config('fitpal.invite_only'), 'now' => Audit::now()]);
    }

    /** Drill-down: one account's workouts, newest first, and body-weight log. */
    public function show(Request $request): JsonResponse
    {
        $id = $request->query('id');
        $u = is_string($id) ? User::query()->find($id) : null;
        if (! $u) {
            return Json::error(404, 'no such user');
        }
        $s = MemberCard::state($u->id);

        return Json::ok([
            'user' => [
                'id' => $u->id, 'name' => $u->name, 'created' => $u->createdIso(), 'disabled' => (bool) $u->disabled,
                'admin' => $u->isAdmin(), 'invitedBy' => Js::or($u->invited_by, null),
                'coach' => $u->isCoach(), 'ownCoachFlag' => (bool) $u->coach, 'coachId' => Js::or($u->coach_id, null),
            ],
            'unit' => Js::or($s->unit ?? null, 'kg'),
            'lastSync' => Js::or($s->_ts ?? null, null),
            'routines' => MemberCard::routineSummaries($s),
            'bodyweight' => Js::or($s->bodyweight ?? null, []),
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
            // having no coach while they still had one. (Presence is dropped here in R3.)
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
            // Member and coach locked in one statement: a coach disabled in the meantime is seen
            // as disabled, and a send to this member waits until the move is done.
            if (! is_string($id)) {
                throw new ClientSafe(404, 'no such user');
            }
            $rows = User::query()->whereKey(array_filter([$id, $coachId], 'strlen'))->lockForUpdate()->get()->keyBy('id');
            $u = $rows->get($id) ?? throw new ClientSafe(404, 'no such user');
            $previous = $u->coach_id;
            if ($coachId === '') {
                $u->forceFill(['coach_id' => null])->save();
                Assignment::expirePending($u->id, $previous);

                return Json::ok(['ok' => true, 'id' => $u->id, 'coachId' => null]);
            }
            $c = $rows->get($coachId);
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

    /** `db.users.find(x => x.id === body.id)`, locked: only a string can match. */
    private static function locked(mixed $id): User
    {
        $u = is_string($id) ? User::query()->whereKey($id)->lockForUpdate()->first() : null;

        return $u ?? throw new ClientSafe(404, 'no such user');
    }
}
