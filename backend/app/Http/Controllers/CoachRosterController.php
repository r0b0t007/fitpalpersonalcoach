<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\MemberCard;
use App\Models\Assignment;
use App\Models\Presence;
use App\Models\User;
use App\Support\Input;
use App\Support\Json;
use App\Tenancy\Access;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The coach's clients (api/server.js GET /api/coach/members, GET /api/coach/member, POST
 * /api/coach/member/release). Behind auth:api and RequireCoach: the caller is a coach or an admin.
 *
 * One client is reached through Access::canCoachMember, and refused with the same 403 whether
 * they do not exist or are not the caller's: a distinguishable answer would let a coach enumerate
 * every account on the instance.
 */
final class CoachRosterController
{
    public function members(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
        // A coach's own active clients; an admin coaches everyone (canCoachMember), as in Node.
        $query = $coach->isAdmin()
            ? User::query()->whereKeyNot($coach->id)->where('disabled', false)
            : User::activeClientsOf($coach);
        // Node's order, which the send sheet shows as is. Each client's state is read one at a
        // time inside card(), deliberately: a blob can be 16 MB, and loading the whole roster's
        // at once would hold all of them in memory together.
        $members = $query->signupOrder()->get()
            ->filter(fn (User $u) => Access::canCoachMember($coach, $u))->values();
        $offers = Assignment::forMembers($members->pluck('id')->all());
        $live = Presence::liveMap();

        return Json::ok([
            'members' => $members->map(fn (User $u) => MemberCard::card($u, $coach->id, $offers->get($u->id, collect()), $live[$u->id] ?? null))->all(),
            'now' => Audit::now(),
        ]);
    }

    public function member(Request $request): JsonResponse
    {
        $member = self::reachable($request, Input::searchParam($request, 'id'));

        return $member ? Json::ok(MemberCard::detail($member)) : Json::error(403, 'forbidden');
    }

    public function release(Request $request): JsonResponse
    {
        // String(body.id || ''), on the body as sent (bad JSON is a 400 here, as readBody made it).
        $id = Input::jsString($request, 'id');
        // Check and write as one step, on a locked row. Node's handler ran without an await between
        // the check and the write; here two requests can interleave, and a release checked against
        // a stale row would drop a client an admin had just moved to another coach.
        $member = DB::transaction(function () use ($request, $id): ?User {
            $member = self::reachable($request, $id, lock: true);
            if (! $member) {
                return null;
            }
            // The member's coach, read under the lock — not the caller. An admin releasing another
            // coach's client must expire THAT coach's offers, or they outlive the relationship and
            // keep eating the member's pending cap.
            $had = $member->coach_id;
            $member->coach_id = null;
            $member->save();
            Assignment::expirePending($member->id, $had);

            return $member;
        });
        if (! $member) {
            return Json::error(403, 'forbidden');
        }
        Audit::record($request, 'coach.member.release', ['user' => $request->user('api'), 'msg' => $member->id]);

        return Json::ok(['ok' => true]);
    }

    /** The member the caller may coach, or null for unknown and not-theirs alike. */
    private static function reachable(Request $request, mixed $id, bool $lock = false): ?User
    {
        if (! is_string($id) || $id === '') {
            return null;
        }
        $query = User::query()->whereKey($id);
        $member = ($lock ? $query->lockForUpdate() : $query)->first();

        return $member && Access::canCoachMember($request->user('api'), $member) ? $member : null;
    }
}
