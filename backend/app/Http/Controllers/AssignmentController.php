<?php

namespace App\Http\Controllers;

use App\Coaching\AssignmentSent;
use App\Coaching\PlanBundle;
use App\Models\Assignment;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use App\Tenancy\Access;
use App\Tenancy\CoachLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Programs a coach sends and a client answers (api/server.js POST /api/coach/assign, POST
 * /api/coach/assignments/withdraw, GET /api/assignments, GET /api/assignments/history, POST
 * /api/assignments/decide). The bundle is stored on the row and merged by the CLIENT's app on
 * accept — never written into their state here, which their next whole-state push would erase.
 *
 * The coach's two routes run in the coach's CoachContext, so a coach withdraws their own offers
 * only. The client's three read across coaches (Assignment::forMember): an inbox holds every
 * coach's offers.
 */
final class AssignmentController
{
    public function assign(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
        $bundle = PlanBundle::validate(Input::raw($request, 'bundle'));
        // `[...new Set(body.memberIds.map(String))]`: first occurrence wins, compared as strings.
        $memberIds = Input::raw($request, 'memberIds');
        $ids = is_array($memberIds) ? array_values(array_unique(array_map(Js::string(...), $memberIds), SORT_STRING)) : [];
        if (! $ids) {
            return Json::error(400, 'pick at least one member');
        }
        $note = Js::slice(Js::trim(Input::jsString($request, 'note')), PlanBundle::NOTE_MAX);
        $schedule = Js::truthy(Input::raw($request, 'schedule'));
        $stored = Js::stringify($bundle);

        $coach = DB::transaction(function () use ($coach, $ids, $note, $schedule, $stored): User {
            // The coach's row first (CoachLock), then the members': the pending cap is counted and
            // the offers written as one step, and a release, a move or the coach being disabled
            // lands either before this reads them or after it is done — never in between.
            $coach = CoachLock::take($coach->id) ?? throw new ClientSafe(403, 'forbidden');
            $locked = User::query()->whereKey($ids)->lockForUpdate()->get()->keyBy('id');
            $pending = Assignment::pendingCounts($ids);
            // In the order sent, and all or nothing: one member that is not the caller's refuses
            // the whole batch, and the first one over the cap is the one named, as in Node.
            foreach ($ids as $id) {
                $u = $locked->get($id);
                if (! Access::canCoachMember($coach, $u)) {
                    throw new ClientSafe(403, 'forbidden');
                }
                if ($pending->get($u->id, 0) >= Assignment::MAX_PENDING) {
                    throw new ClientSafe(429, Say::f('{0} already has {1} programs waiting', $u->name, Assignment::MAX_PENDING));
                }
            }
            $created = Js::isoNow();
            foreach ($ids as $id) {
                Assignment::offer($coach, $locked->get($id)->id, $stored, $note, $schedule, created: $created);
            }

            return $coach;
        });
        AssignmentSent::dispatch($coach, $ids);

        return Json::ok(['ok' => true, 'sent' => count($ids)]);
    }

    /**
     * Pull back an offer nobody has answered. Only the coach who sent it (the CoachContext scope),
     * and only while pending: once a client has acted on it, it is their data.
     */
    public function withdraw(Request $request): JsonResponse
    {
        $id = Input::raw($request, 'id');
        DB::transaction(function () use ($id): void {
            $a = is_string($id) ? Assignment::query()->whereKey($id)->lockForUpdate()->first() : null;
            if (! $a) {
                throw new ClientSafe(404, 'no such assignment');
            }
            if ($a->status !== 'pending') {
                throw new ClientSafe(409, 'already decided');
            }
            $a->forceFill(['status' => 'withdrawn', 'decided_at' => Js::isoNow()])->save();
        });

        return Json::ok(['ok' => true]);
    }

    /** The client's inbox: pending only — a decided offer is already merged into their plan. */
    public function inbox(Request $request): JsonResponse
    {
        $mine = Assignment::pendingFor($request->user('api')->id)->get();

        return Json::ok(['assignments' => $mine->map(fn (Assignment $a) => $a->toInbox())->all()]);
    }

    /**
     * What the client has answered, newest answer first, without the bundles. Accepted and
     * declined only — the same "decided" as the member card: a withdrawn offer was taken back
     * before they acted on it, an expired one outlived the relationship, and serving either back
     * would hand over something nobody decided to share. Bounded by prune(), so no limit.
     */
    public function history(Request $request): JsonResponse
    {
        // `String(b.decidedAt || b.created || '').localeCompare(…)`, descending: the binary
        // collation orders the ISO strings Node wrote as localeCompare does. Ties fall back to the
        // order sent, as JS's stable sort kept them.
        $mine = Assignment::forMember($request->user('api')->id)->whereIn('status', ['accepted', 'declined'])
            ->orderByRaw("COALESCE(NULLIF(decided_at, ''), created) DESC")->orderBy('created')->orderBy('id')->get();

        return Json::ok(['assignments' => $mine->map(fn (Assignment $a) => $a->toHistory())->all()]);
    }

    public function decide(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user('api');
        $id = Input::raw($request, 'id');
        $accept = Js::truthy(Input::raw($request, 'accept'));

        return DB::transaction(function () use ($user, $id, $accept): JsonResponse {
            // The member's own row first, as release and assign lock it: a move to another coach
            // either lands before this reads coach_id or waits until it is done.
            $me = User::query()->whereKey($user->id)->lockForUpdate()->first();
            // Only the recipient answers, and only their own — never the coach, never another member.
            $a = is_string($id) ? Assignment::forMember($user->id)->whereKey($id)->lockForUpdate()->first() : null;
            if (! $a) {
                throw new ClientSafe(404, 'no such assignment');
            }
            // Re-checked at the answer, not only at the send: the client may have been moved to
            // another coach, or the coach disabled, since. The offer is retired, and that sticks —
            // returned rather than thrown, so the expiry is committed along with its 409.
            $accepting = $a->status === 'pending' && $accept;
            $sender = $accepting ? User::query()->find($a->coach_id) : null;
            if ($accepting && (! $sender || ! Access::canCoachMember($sender, $me))) {
                $a->forceFill(['status' => 'expired', 'decided_at' => Js::isoNow()])->save();

                return Json::error(409, 'that program is no longer available');
            }
            if ($a->status !== 'pending') {
                throw new ClientSafe(409, 'already decided');
            }
            $a->forceFill(['status' => $accept ? 'accepted' : 'declined', 'decided_at' => Js::isoNow()])->save();

            return Json::ok(['ok' => true, 'status' => $a->status]);
        });
    }
}
