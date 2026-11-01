<?php

namespace App\Coaching;

use App\Models\Assignment;
use App\Models\CoachPage;
use App\Models\CoachProgram;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Js;

/**
 * The program a coach's page gives every client it brings in (CHW-338): offered the moment a
 * request is accepted, as an `auto` offer the client's app takes in by itself, so workout 1 is
 * there the day they join and nobody waits on "{coach} is preparing your program". An ordinary
 * offer otherwise, as AssignmentController::assign makes them: the bundle on the row, merged by the
 * client's app, never written into their state here.
 *
 * Runs in the coach's CoachContext and the caller's transaction, after the client is on the
 * roster. No starter set, a program since deleted or unreadable, or a client already at the
 * pending cap: nothing is offered, and the accept stands.
 */
final class Starter
{
    public static function offer(User $coach, User $member): bool
    {
        $id = CoachPage::query()->find($coach->id)?->starter_program_id;
        $program = $id === null ? null : CoachProgram::query()->where('program_id', $id)->first();
        if ($program === null) {
            return false;
        }
        if (Assignment::pendingCounts([$member->id])->get($member->id, 0) >= Assignment::MAX_PENDING) {
            return false;
        }
        try {
            $bundle = PlanBundle::validate(json_decode((string) $program->bundle));
        } catch (ClientSafe) {
            return false;
        }
        (new Assignment)->forceFill([
            'id' => Js::randomId(), 'coach_id' => $coach->id, 'coach_name' => $coach->name, 'member_id' => $member->id,
            'bundle' => Js::stringify($bundle), 'note' => '', 'schedule' => true, 'auto' => true,
            'created' => Js::isoNow(), 'status' => 'pending',
        ])->save();

        return true;
    }
}
