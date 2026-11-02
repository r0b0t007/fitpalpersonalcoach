<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\HealthConsent;
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
use App\Support\Say;
use App\Tenancy\Access;
use App\Tenancy\CoachLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
 *  - POST /api/notes/read {ids} (client): the ones their coach's screen showed them, read.
 */
final class CoachNoteController
{
    /** At most one email a day about new notes, per client. */
    private const MAIL_EVERY = 86400;

    public function create(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');
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
            throw new ClientSafe(400, Say::f('note too long (max {0} characters)', CoachNote::BODY_MAX));
        }
        // The coach, then the client, locked as Detach and a release lock them: a note written
        // while the link ends would outlive the delete that ends it, and reach a client who left.
        [$member, $note] = DB::transaction(function () use ($request, $coach, $type, $key, $body): array {
            $me = CoachLock::take($coach->id) ?? throw new ClientSafe(403, 'forbidden');
            $id = Input::jsString($request, 'memberId');
            $member = $id === '' ? null : User::query()->whereKey($id)->lockForUpdate()->first();
            if (! Access::canCoachMember($me, $member) || $member->coach_id !== $me->id) {
                throw new ClientSafe(403, 'forbidden');
            }
            // A check-in is health data: no reply to one they have not agreed to share (CHW-360).
            if ($type === 'checkin' && HealthConsent::missing($member)) {
                throw new ClientSafe(400, 'bad note target');
            }
            $note = tap((new CoachNote)->forceFill([
                'id' => Js::randomId(), 'coach_id' => $me->id, 'member_id' => $member->id,
                'ref_type' => $type, 'ref_key' => $key, 'body' => $body, 'created' => Js::nowMs(),
            ]))->save();

            return [$member, $note];
        });
        Audit::record($request, 'coach.note.create', ['user' => $coach, 'msg' => $member->id]);
        self::tell($member, $coach);

        return Json::ok(['note' => $note->toApi(), 'notes' => CoachNote::listedFor($member)]);
    }

    public function index(Request $request): JsonResponse
    {
        $notes = CoachNote::forMember($request->user('api'))->orderByDesc('created')->limit(CoachNote::LIST_MAX)->get();

        return Json::ok(['notes' => $notes->map(fn (CoachNote $n) => $n->toApi())->all()]);
    }

    /** Only the ones named: a note the screen did not show stays unread, to the coach as well. */
    public function read(Request $request): JsonResponse
    {
        $ids = array_values(array_filter((array) Input::raw($request, 'ids'), 'is_string'));
        if ($ids !== []) {
            CoachNote::forMember($request->user('api'))->whereKey(array_slice($ids, 0, CoachNote::LIST_MAX))
                ->whereNull('read_at')->update(['read_at' => Js::nowMs()]);
        }

        return $this->index($request);
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
