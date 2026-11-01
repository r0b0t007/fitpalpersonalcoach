<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Jobs\SendPush;
use App\Mail\AccountMail;
use App\Mail\SendAfterResponse;
use App\Models\CoachNote;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Tenancy\Access;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * A coach's replies to check-ins and comments on workouts (CHW-340): the coaching relationship in
 * the app, without a chat.
 *
 *  - POST /api/coach/notes {memberId, refType, refKey, body} (coach): a note on one check-in (its
 *    date) or one workout (its id). The client is told by a push on the next tick of the queue; one
 *    with no push subscription (an iPhone without the app installed, often) by an email instead, at
 *    most one a day, which says who replied and not what: the app is where it is read.
 *  - GET /api/notes (client): the notes from the coach they have now, newest first.
 *  - POST /api/notes/read (client): every one of them read, as opening their coach's screen does.
 */
final class CoachNoteController
{
    /** At most one email a day about new notes, per client. */
    private const MAIL_EVERY = 86400;

    public function create(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
        $member = User::query()->find(Input::jsString($request, 'memberId'));
        if (! Access::canCoachMember($coach, $member) || $member->coach_id !== $coach->id) {
            throw new ClientSafe(403, 'forbidden');
        }
        $type = Input::raw($request, 'refType');
        $key = Js::trim(Input::jsString($request, 'refKey'));
        if (! in_array($type, CoachNote::REF_TYPES, true) || $key === '' || mb_strlen($key) > 64) {
            throw new ClientSafe(400, 'bad note target');
        }
        $body = Js::trim(Input::jsString($request, 'body'));
        if ($body === '') {
            throw new ClientSafe(400, 'write a note first');
        }
        if (mb_strlen($body) > CoachNote::BODY_MAX) {
            throw new ClientSafe(400, 'note too long');
        }
        $note = tap((new CoachNote)->forceFill([
            'id' => CoachNote::newId(), 'coach_id' => $coach->id, 'member_id' => $member->id,
            'ref_type' => $type, 'ref_key' => $key, 'body' => $body, 'created' => Js::nowMs(),
        ]))->save();
        Audit::record($request, 'coach.note.create', ['user' => $coach, 'msg' => $member->id]);
        self::tell($member, $coach);

        return Json::ok(['note' => $note->toApi(), 'notes' => self::forCoach($member)]);
    }

    public function index(Request $request): JsonResponse
    {
        $notes = CoachNote::forMember($request->user('api'))->orderByDesc('created')->limit(CoachNote::LIST_MAX)->get();

        return Json::ok(['notes' => $notes->map(fn (CoachNote $n) => $n->toApi())->all()]);
    }

    public function read(Request $request): JsonResponse
    {
        CoachNote::forMember($request->user('api'))->whereNull('read_at')->update(['read_at' => Js::nowMs()]);

        return $this->index($request);
    }

    /** The notes on $member a coach's client page shows (MemberCard::detail), in the coach's context. */
    public static function forCoach(User $member): array
    {
        return CoachNote::query()->where('member_id', $member->id)->orderByDesc('created')->limit(CoachNote::LIST_MAX)->get()
            ->map(fn (CoachNote $n) => $n->toApi())->all();
    }

    /** A push where they have one, else one email a day to an address they proved. */
    private static function tell(User $member, User $coach): void
    {
        if (PushSubscription::query()->where('user_id', $member->id)->exists()) {
            SendPush::dispatch($member->id, 'coach-note', [(string) $coach->name]);

            return;
        }
        if ($member->email === null || $member->email_verified_at === null) {
            return;
        }
        RateLimiter::attempt('note-mail:'.$member->id, 1, fn () => SendAfterResponse::to($member->email,
            new AccountMail('note', $member, rtrim((string) config('fitpal.origin'), '/').'/#/mycoach', coach: (string) $coach->name)), self::MAIL_EVERY);
    }
}
