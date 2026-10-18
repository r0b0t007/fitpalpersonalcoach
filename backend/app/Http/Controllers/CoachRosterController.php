<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\MemberCard;
use App\Models\Assignment;
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
        // Node's db.users is in creation order; its oldest accounts have no date and come first.
        $members = $query->orderBy('created_at')->orderBy('id')->get()
            ->filter(fn (User $u) => Access::canCoachMember($coach, $u))->values();
        $offers = Assignment::forMembers($members->pluck('id')->all());

        return Json::ok([
            'members' => $members->map(fn (User $u) => MemberCard::card($u, $coach->id, $offers->get($u->id, collect())))->all(),
            'now' => Audit::now(),
        ]);
    }

    public function member(Request $request): JsonResponse
    {
        $member = self::reachable($request, $request->query('id'));

        return $member ? Json::ok(MemberCard::detail($member)) : Json::error(403, 'forbidden');
    }

    public function release(Request $request): JsonResponse
    {
        $member = self::reachable($request, Input::str($request, 'id'));
        if (! $member) {
            return Json::error(403, 'forbidden');
        }
        // The member's coach, read before the change — not the caller. An admin releasing another
        // coach's client must expire THAT coach's offers, or they outlive the relationship and
        // keep eating the member's pending cap.
        $had = $member->coach_id;
        DB::transaction(function () use ($member, $had): void {
            $member->coach_id = null;
            $member->save();
            Assignment::expirePending($member->id, $had);
        });
        Audit::record($request, 'coach.member.release', ['user' => $request->user('api'), 'msg' => $member->id]);

        return Json::ok(['ok' => true]);
    }

    /** The member the caller may coach, or null for unknown and not-theirs alike. */
    private static function reachable(Request $request, mixed $id): ?User
    {
        $member = is_string($id) && $id !== '' ? User::query()->find($id) : null;

        return $member && Access::canCoachMember($request->user('api'), $member) ? $member : null;
    }
}
