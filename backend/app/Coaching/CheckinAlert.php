<?php

namespace App\Coaching;

use App\Jobs\SendPush;
use App\Models\User;
use App\Support\Js;

/**
 * A coached client just filed a check-in: their coach gets a push (CHW-339), so a coach no longer
 * has to keep opening Today to find out. Read off the sync that carried it (DataController::store):
 * a newest check-in date above the newest any sync had carried before (user_states.checkin_seen).
 */
final class CheckinAlert
{
    /**
     * How far back a newly raised date may be and still be news. The date is the client's local
     * day and the server's is UTC, a day apart at most either way; anything older came in with a
     * restored backup or a phone that was offline for days, and a push about it now is noise.
     */
    public const FRESH_DAYS = 2;

    public static function after(User $member, ?string $before, ?string $after): void
    {
        if ($after === null || ($before !== null && strcmp($after, $before) <= 0)) {
            return;   // nothing newer: an edit, a stale device, a check-in deleted and filed again, or none
        }
        if (strcmp($after, Js::addDaysIso(now()->utc()->format('Y-m-d'), -self::FRESH_DAYS)) < 0) {
            return;
        }
        // Their coach sees none of their check-ins until they agree (CHW-360), so is not told of one.
        if ($member->coach_id === null || ! HealthConsent::given($member)) {
            return;
        }
        $coach = User::query()->whereKey($member->coach_id)->where('disabled', false)->first();
        if ($coach !== null) {
            SendPush::dispatch($coach->id, 'checkin-in', [(string) $member->name, $member->id]);
        }
    }
}
