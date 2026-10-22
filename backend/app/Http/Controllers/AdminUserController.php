<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\MemberCard;
use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Models\Assignment;
use App\Models\Licence;
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
 * /api/admin/user/disable, /coach, /assign-coach), and the licence a coach is given by hand (R4:
 * POST /api/admin/licence/grant and /revoke). Behind RequireAdmin, with no CoachContext: the
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
        [$u, $was] = DB::transaction(function () use ($id, $coach): array {
            $u = self::locked($id);
            $was = $u->isCoach();
            $u->forceFill(['coach' => $coach])->save();
            // An admin is still a coach with the flag off: nothing is detached, their roster and
            // offers stay valid because they never lost the ability to coach.
            if (! $coach && ! $u->isCoach()) {
                Detach::coach($u);
            }

            return [$u, $was];
        }, self::ATTEMPTS);
        // Recorded after the commit, as every audit here is; only a change of what the account can
        // do (isCoach before and after) — an admin coaches whatever their flag says, so setting
        // or clearing it changes nothing. Node recorded none of these. Two literal calls, not a
        // ternary: check-audit-labels finds event names by their literal.
        $who = ['user' => $request->user('api'), 'target' => $u];
        if (! $was && $u->isCoach()) {
            Audit::record($request, 'admin.user.coach', $who);
        } elseif ($was && ! $u->isCoach()) {
            Audit::record($request, 'admin.user.uncoach', $who);
        }

        return Json::ok(['ok' => true, 'id' => $u->id, 'coach' => (bool) $u->coach]);
    }

    public function assignCoach(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        $coachId = Js::trim(Input::jsString($request, 'coachId'));

        $moved = DB::transaction(function () use ($id, $coachId): array {
            // The coach's row first (CoachLock), then the member's: a coach disabled in the meantime
            // is seen as disabled, and a send to this member waits until the move is done.
            $c = $coachId === '' ? null : CoachLock::take($coachId);
            $u = self::locked($id);
            $previous = $u->coach_id;
            if ($coachId === '') {
                $u->forceFill(['coach_id' => null])->save();
                Assignment::expirePending($u->id, $previous);

                return [$u, null, $previous];
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

            return [$u, $c, $previous];
        }, self::ATTEMPTS);
        [$u, $c, $previous] = $moved;
        // Node recorded none of these. Only a move. The new coach is named by id, as
        // coach.member.release names the member (msg carries codes and ids: a name is personal
        // data and goes stale); taking a client off every roster is an event of its own.
        if ($previous !== $c?->id) {
            $who = ['user' => $request->user('api'), 'target' => $u];
            if ($c !== null) {
                Audit::record($request, 'admin.user.assign', $who + ['msg' => $c->id]);
            } else {
                Audit::record($request, 'admin.user.unassign', $who);
            }
        }

        return Json::ok(['ok' => true, 'id' => $u->id, 'coachId' => $c?->id]);
    }

    /**
     * POST /api/admin/licence/grant {id, plan} — a coach licensed by hand, no Creem involved: the
     * existing coach at cutover (spec §11), a partner, a refund made good. A `manual` row, writable
     * until revoked; granting again changes its plan. A coach whose Creem subscription can still
     * bill (Licence::canStillBill) is refused, not overwritten: they would pay twice, or a webhook
     * would undo the grant — the subscription is changed or canceled in Creem first. One that is
     * over (canceled, even inside its paid period; expired), or a checkout never finished, is left
     * as it is and stops being theirs (the webhook updates such a row without taking licence_id
     * back from a grant: spec §6). A disabled coach is refused, as assign-coach refuses one, and
     * an admin, whom no licence limits. Allowed with billing off too, so the cutover can license
     * the coach before Creem is set up. Granting the plan a coach already holds changes nothing
     * and records nothing.
     */
    public function grant(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        $plan = Input::raw($request, 'plan');
        [$u, $changed] = DB::transaction(function () use ($id, $plan): array {
            // The coach's row first, then the licence: the order Entitlement::for(lock) reads them.
            $u = self::locked($id);
            if (! $u->isCoach()) {
                throw new ClientSafe(400, 'that user is not a coach');
            }
            if ($u->isAdmin()) {
                throw new ClientSafe(400, 'an admin needs no plan');
            }
            if ($u->disabled) {
                throw new ClientSafe(400, 'that coach is disabled');
            }
            if (! is_string($plan) || Plans::cap($plan) === null) {
                throw new ClientSafe(400, 'no such plan');
            }
            $licence = Entitlement::licenceOf($u, 'update');
            if ($licence?->canStillBill()) {
                throw new ClientSafe(409, 'that coach has a Creem subscription — change or cancel it there first');
            }
            // Only a grant still in force is changed in place; anything else (a hand-edited or
            // revoked row that is somehow still pointed at) stays as history behind a new one.
            if ($licence?->source === 'manual' && $licence->status === 'manual') {
                if ($licence->plan === $plan) {
                    return [$u, false];
                }
            } else {
                $licence = (new Licence)->forceFill(['id' => Licence::newId(), 'user_id' => $u->id, 'source' => 'manual', 'status' => 'manual']);
            }
            $licence->forceFill(['plan' => $plan])->save();
            $u->forceFill(['licence_id' => $licence->id])->save();

            return [$u, true];
        }, self::ATTEMPTS);
        if ($changed) {
            Audit::record($request, 'admin.licence.grant', ['user' => $request->user('api'), 'target' => $u, 'msg' => $plan]);
        }

        return Json::ok(['ok' => true, 'id' => $u->id, 'entitlement' => Entitlement::for($u)->toArray()]);
    }

    /**
     * POST /api/admin/licence/revoke {id} — takes back a licence granted by hand. A Creem licence
     * is not the admin's to remove (it ends in Creem), so only a manual one is: anything else is
     * "nothing to revoke". The row stays, marked `revoked`, as the history of what was granted
     * (the audit log is pruned); the coach is then unlicensed — read-only while billing is on.
     */
    public function revoke(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        [$u, $plan] = DB::transaction(function () use ($id): array {
            $u = self::locked($id);
            $licence = Entitlement::licenceOf($u, 'update');
            if ($licence?->source !== 'manual') {
                throw new ClientSafe(400, 'that account has no granted plan to revoke');
            }
            $u->forceFill(['licence_id' => null])->save();
            $licence->forceFill(['status' => 'revoked', 'canceled_at' => now()])->save();

            return [$u, $licence->plan];
        }, self::ATTEMPTS);
        // The plan taken back: the log says what, should the row later be edited.
        Audit::record($request, 'admin.licence.revoke', ['user' => $request->user('api'), 'target' => $u, 'msg' => $plan]);

        return Json::ok(['ok' => true, 'id' => $u->id, 'entitlement' => Entitlement::for($u)->toArray()]);
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
