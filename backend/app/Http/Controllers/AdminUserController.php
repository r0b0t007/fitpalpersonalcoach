<?php

namespace App\Http\Controllers;

use App\Admin\Accounts;
use App\Audit\Audit;
use App\Coaching\MemberCard;
use App\Domain\Entitlement;
use App\Models\Licence;
use App\Models\Presence;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The owner's account controls (api/server.js GET /api/admin/users, GET /api/admin/user, POST
 * /api/admin/user/disable, /coach, /assign-coach), and the licence a coach is given by hand (R4:
 * POST /api/admin/licence/grant and /revoke). Behind RequireAdmin, with no CoachContext: the
 * admin acts on every account. Granting the coach role and pointing a member at a coach are
 * admin-only — the whole point of the role is that a coach cannot widen their own reach.
 *
 * The writes are App\Admin\Accounts, shared with the Filament panel: one implementation, one
 * audit trail, whichever way the owner acts.
 */
final class AdminUserController
{
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
        $u = Accounts::disable($request, $request->user('api'), Input::raw($request, 'id'), Js::truthy(Input::raw($request, 'disabled')));

        return Json::ok(['ok' => true, 'id' => $u->id, 'disabled' => (bool) $u->disabled]);
    }

    public function coach(Request $request): JsonResponse
    {
        $u = Accounts::setCoach($request, $request->user('api'), Input::raw($request, 'id'), Js::truthy(Input::raw($request, 'coach')));

        return Json::ok(['ok' => true, 'id' => $u->id, 'coach' => (bool) $u->coach]);
    }

    public function assignCoach(Request $request): JsonResponse
    {
        [$u, $c] = Accounts::assignCoach($request, $request->user('api'), Input::raw($request, 'id'), Js::trim(Input::jsString($request, 'coachId')));

        return Json::ok(['ok' => true, 'id' => $u->id, 'coachId' => $c?->id]);
    }

    /** POST /api/admin/licence/grant {id, plan} — a licence by hand (Accounts::grant). */
    public function grant(Request $request): JsonResponse
    {
        $u = Accounts::grant($request, $request->user('api'), Input::raw($request, 'id'), Input::raw($request, 'plan'));

        return Json::ok(['ok' => true, 'id' => $u->id, 'entitlement' => Entitlement::for($u)->toArray()]);
    }

    /** POST /api/admin/licence/revoke {id} — a granted licence taken back (Accounts::revoke). */
    public function revoke(Request $request): JsonResponse
    {
        $u = Accounts::revoke($request, $request->user('api'), Input::raw($request, 'id'));

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
}
