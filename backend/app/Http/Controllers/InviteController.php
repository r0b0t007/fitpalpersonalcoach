<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Auth\InviteGate;
use App\Models\Invite;
use App\Models\User;
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
 * Invite codes (api/server.js): the landing screen's lookup, redeeming from an existing account,
 * a coach's own codes, and the admin's general ones.
 *
 * A coach's routes run in their CoachContext, so Invite queries see the codes minted FOR that coach
 * (coach_id), never an admin's general codes nor another coach's — and "no such code" answers both
 * "does not exist" and "not yours", so nobody can probe for codes by watching which reply differs.
 */
final class InviteController
{
    /** At most this many unused, unrevoked codes per coach. */
    public const COACH_MAX_OPEN = 20;

    /** Lifetime, revoked ones included: a client looping mint-and-revoke cannot grow the table. */
    public const COACH_MAX_LIFETIME = 500;

    /** GET /api/invite?code= — whose invite this is, before the person has an account. */
    public function show(Request $request): JsonResponse
    {
        $invite = InviteGate::redeemable(Input::searchParam($request, 'code'));
        // One 404 for "no such code", "used" and "revoked": telling them apart would make this a
        // scanner for codes that ever existed, and the holder needs a new link either way.
        if (! $invite) {
            return Json::error(404, 'this invite link is not valid any more');
        }

        // Judged as registration will judge it, so the screen never promises a coach the signup
        // would not give them.
        return Json::ok(['coachName' => InviteGate::coachBinding($invite)?->name]);
    }

    /** POST /api/invite/redeem — joining a coach from an account that already exists. */
    public function redeem(Request $request): JsonResponse
    {
        $code = Input::jsString($request, 'code');
        $redeemed = null;

        $response = DB::transaction(function () use ($request, $code, &$redeemed): JsonResponse {
            /** @var User $user */
            $user = User::query()->whereKey($request->user('api')->id)->lockForUpdate()->firstOrFail();
            // Refused before the code is looked at: a client cannot be moved between coaches by
            // whoever sends them a link next. Their coach releases them, or an admin reassigns.
            if ($user->coach_id !== null) {
                return Json::error(409, 'you already have a coach — they can release you first');
            }
            $invite = InviteGate::redeemable($code, lock: true);
            if (! $invite) {
                return Json::error(404, 'this invite link is not valid any more');
            }
            $coach = InviteGate::coachBinding($invite, lock: true);
            // A general code binds nobody: burning it here would spend a signup code for nothing.
            if (! $coach) {
                return Json::error(400, 'this code does not belong to a coach');
            }
            // A coach opening their own link would end up coaching themselves, with no way out.
            if ($coach->id === $user->id) {
                return Json::error(400, 'that is your own invite link');
            }
            if ($user->disabled) {
                return Json::error(403, 'forbidden');
            }
            $user->coach_id = $coach->id;
            $user->save();
            $invite->forceFill(['used_by' => $user->id, 'used_at' => Js::isoNow()])->save();
            $redeemed = [$user, $invite->code];

            return Json::ok(['user' => $user->toPublic()]);
        });
        // Recorded after the commit: an audit write (and the prune it may trigger) must not hold
        // the locks a sign-up spending the same code is waiting on.
        if ($redeemed) {
            Audit::record($request, 'invite.redeem', ['user' => $redeemed[0], 'msg' => $redeemed[1]]);
        }

        return $response;
    }

    /** GET /api/coach/invites — the codes minted for this coach. */
    public function coachIndex(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $invites = Invite::query()->orderBy('seq')->get();
        $users = User::query()->whereKey($invites->pluck('used_by')->filter()->all())->get()->keyBy('id');

        return Json::ok([
            'invites' => $invites->map(fn (Invite $i) => [
                'code' => $i->code, 'note' => $i->note, 'created' => $i->created, 'revoked' => $i->revoked,
                'usedAt' => $i->used_at,
                // Named only while the redeemer is still this coach's to coach: a name handed out
                // for someone who is not theirs would undo the 403 that guards the member route.
                'usedByName' => ($u = $users->get($i->used_by)) && Access::canCoachMember($coach, $u) ? $u->name : null,
            ])->all(),
            'max' => self::COACH_MAX_OPEN,
        ]);
    }

    /** POST /api/coach/invites/new */
    public function coachCreate(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        // Read first, as Node read the body before its caps: a bad body is a 400 even at the cap.
        $note = Input::jsString($request, 'note');
        // The count and the mint as one step, serialised on the coach's own row: two taps at 19
        // open codes must not both pass the cap (Node had no await between the check and the push).
        $invite = DB::transaction(function () use ($coach, $note): Invite|JsonResponse {
            $me = CoachLock::take($coach->id);
            // Judged again on the locked row: a detach (role revoked, account disabled) holds this
            // lock while it revokes the coach's open codes, and a mint that waited behind it must
            // not then hand out a fresh one. Refused as RequireCoach would refuse the next request.
            if (! $me || $me->disabled) {
                return Json::error(401, 'not signed in');
            }
            if (! $me->isCoach()) {
                return Json::error(403, 'forbidden');
            }
            if (Invite::query()->whereNull('used_by')->where('revoked', false)->count() >= self::COACH_MAX_OPEN) {
                return Json::error(429, Say::f('you already have {0} unused codes — revoke one before making another', self::COACH_MAX_OPEN));
            }
            if (Invite::query()->count() >= self::COACH_MAX_LIFETIME) {
                return Json::error(429, 'too many codes made on this account — ask an admin');
            }

            return Invite::mint($coach, $note, $coach->id);
        });
        if ($invite instanceof JsonResponse) {
            return $invite;
        }
        Audit::record($request, 'coach.invite.create', ['user' => $coach, 'msg' => $invite->code]);

        return Json::ok(['invite' => $invite->toNode()]);
    }

    /** POST /api/coach/invites/revoke — 404 for "no such code" and "not yours" alike (the scope). */
    public function coachRevoke(Request $request): JsonResponse
    {
        return self::revoke($request, 'coach.invite.revoke');
    }

    /** GET /api/admin/invites — every code, as Node stored it, with the redeemer's name. */
    public function adminIndex(): JsonResponse
    {
        $invites = Invite::query()->orderBy('seq')->get();
        $names = User::query()->whereKey($invites->pluck('used_by')->filter()->all())->pluck('name', 'id');

        return Json::ok([
            'invites' => $invites->map(fn (Invite $i) => $i->toNode() + ['usedByName' => $i->used_by ? ($names[$i->used_by] ?? null) : null])->all(),
            'invite_only' => (bool) config('fitpal.invite_only'),
        ]);
    }

    /** POST /api/admin/invites/new — a general code: it binds nobody. */
    public function adminCreate(Request $request): JsonResponse
    {
        $admin = $request->user('api');
        $invite = Invite::mint($admin, Input::jsString($request, 'note'));
        Audit::record($request, 'admin.invite.create', ['user' => $admin, 'msg' => $invite->code]);

        return Json::ok(['invite' => $invite->toNode()]);
    }

    /** POST /api/admin/invites/revoke */
    public function adminRevoke(Request $request): JsonResponse
    {
        return self::revoke($request, 'admin.invite.revoke');
    }

    /**
     * Both revoke routes: the code as sent, upper-cased and NOT trimmed (Node did not trim, and
     * TrimStrings has, hence jsString), looked up in the caller's scope — a coach's own codes;
     * everything on the admin route, which has no context.
     */
    private static function revoke(Request $request, string $event): JsonResponse
    {
        $invite = Invite::query()->find(mb_strtoupper(Input::jsString($request, 'code')));
        if (! $invite) {
            return Json::error(404, 'no such code');
        }
        if ($invite->used_by !== null) {
            return Json::error(400, 'already used — cannot revoke');
        }
        $invite->revoke();
        Audit::record($request, $event, ['user' => $request->user('api'), 'msg' => $invite->code]);

        return Json::ok(['ok' => true]);
    }
}
