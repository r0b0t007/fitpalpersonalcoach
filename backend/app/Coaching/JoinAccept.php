<?php

namespace App\Coaching;

use App\Domain\Entitlement;
use App\Mail\JoinAnswerMail;
use App\Mail\SendAfterResponse;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Js;
use App\Support\Say;
use App\Tenancy\CoachLock;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Answering a join request (CHW-337): the coach's Accept or Decline in their inbox, and since
 * CHW-338 the same accept run by itself when the coach's page accepts every request (auto-accept,
 * JoinController::verify). Runs in the coach's CoachContext, so a request is only ever their own.
 *
 * Accept is the first moment the follower has an account: made here, on this coach's roster, with
 * the address the code proved — or an account that already had that address and no coach, bound.
 * Behind the seat check, under the coach's lock, as every way onto a roster is (InviteController::
 * redeem): the request row first, then the follower's, then the coach's. A follower already with a
 * coach is never moved — their request lapses instead. A new client is offered the page's starter
 * program in the same step (Starter).
 */
final class JoinAccept
{
    /**
     * The refusal (for the caller to throw once this has committed), the client, the request, and
     * whether a starter program was offered.
     *
     * @return array{0: ClientSafe|null, 1: User|null, 2: JoinRequest|null, 3: bool}
     */
    public static function decide(User $coach, string $id, bool $accept): array
    {
        try {
            // A refusal is returned from the transaction and thrown after it: a request that lapses
            // because its follower found another coach must stay lapsed.
            return DB::transaction(fn (): array => self::locked($coach, $id, $accept));
        } catch (UniqueConstraintViolationException) {
            // Two coaches accepting one follower at once: the address is unique, the first one has them.
            throw new ClientSafe(409, 'they already train with another coach');
        } catch (QueryException $e) {
            // The same race seen by MariaDB as a deadlock or a lock wait: one accept won it, and this
            // one is the 409 it would otherwise have been.
            if (in_array($e->errorInfo[1] ?? null, [1213, 1205], true) || ($e->errorInfo[0] ?? null) === '40001') {
                throw new ClientSafe(409, 'they already train with another coach');
            }
            throw $e;
        }
    }

    /**
     * The answer, mailed to the follower in the language of their form (CHW-337): accepted, with
     * the way back to the join page, where the browser that asked signs in; declined, nothing more.
     */
    public static function tellFollower(JoinRequest $join, User $coach, bool $accepted): void
    {
        $handle = CoachPage::query()->first()?->handle;
        $url = $handle !== null ? rtrim((string) config('fitpal.origin'), '/').'/#/join/'.$handle : null;
        SendAfterResponse::to($join->email, new JoinAnswerMail($accepted, (string) $coach->name, $join->lang, $url));
    }

    /** @return array{0: ClientSafe|null, 1: User|null, 2: JoinRequest|null, 3: bool} */
    private static function locked(User $coach, string $id, bool $accept): array
    {
        $join = $id === '' ? null : JoinRequest::query()->whereKey($id)->lockForUpdate()->first();
        if ($join === null || $join->status !== 'pending') {
            return [new ClientSafe(404, 'no such request'), null, null, false];
        }
        $now = Js::nowMs();
        if (! $accept) {
            $join->forceFill(['status' => 'declined', 'intake' => JoinRequest::BLANK, 'decided' => $now])->save();

            return [null, null, $join, false];
        }
        // Read, then locked by its key only when it exists: a locking read of a row that is not
        // there takes a gap lock on MariaDB, and two accepts of one new address would deadlock.
        $found = User::query()->where('email', $join->email)->value('id');
        $user = $found !== null ? User::query()->whereKey($found)->lockForUpdate()->first() : null;
        $lapse = function (ClientSafe $why) use ($join, $now): array {
            $join->forceFill(['status' => 'expired', 'intake' => JoinRequest::BLANK, 'decided' => $now])->save();

            return [$why, null, null, false];
        };
        if ($user !== null && $user->coach_id === $coach->id) {
            // Already on this roster (an invite link, say): the request is answered by that.
            $join->forceFill(['status' => 'accepted', 'member_id' => $user->id, 'decided' => $now])->save();

            return [null, $user, $join, false];
        }
        if ($user?->disabled) {
            return $lapse(new ClientSafe(409, 'this account has been disabled'));
        }
        if ($user?->isCoach()) {
            return $lapse(new ClientSafe(409, 'that address belongs to a coach account'));
        }
        if ($user !== null && $user->coach_id !== null) {
            // A follower who asked two coaches: never moved from the one who accepted first.
            return $lapse(new ClientSafe(409, 'they already train with another coach'));
        }
        // The coach judged again on their locked row (a detach holds this lock while it lets a coach
        // go), and the seat counted on it: two accepts cannot both take the last seat.
        $me = CoachLock::take($coach->id);
        if (! $me || $me->disabled) {
            return [new ClientSafe(401, 'not signed in'), null, null, false];
        }
        if (! $me->isCoach()) {
            return [new ClientSafe(403, 'forbidden'), null, null, false];
        }
        $entitlement = Entitlement::for($me, lock: true);
        if (! $entitlement->canTakeClient) {
            return [new ClientSafe(402, Say::f('your plan allows {0} clients — upgrade to accept more', (int) $entitlement->cap)), null, null, false];
        }
        $user ??= (new User)->forceFill(['id' => User::newId(), 'name' => $join->name, 'email' => $join->email]);
        // The address is proven: the follower typed the code it received.
        $user->forceFill(['coach_id' => $coach->id, 'email_verified_at' => $user->email_verified_at ?? now()])->save();
        $join->forceFill(['status' => 'accepted', 'member_id' => $user->id, 'decided' => $now])->save();

        return [null, $user, $join, Starter::offer($me, $user)];
    }
}
