<?php

namespace App\Coaching;

use App\Models\User;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A coach sent a program to these members. Delivered only once the rows are committed, even when
 * the send runs inside a caller's own transaction (ShouldDispatchAfterCommit): a push must never
 * announce an offer that was rolled back.
 *
 * Each member is then pushed a notification in their own language (assignmentPush), queued
 * (AppServiceProvider). A member without push finds the offer the next time they open the app.
 */
final class AssignmentSent implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    /** @param  list<string>  $memberIds */
    public function __construct(public readonly User $coach, public readonly array $memberIds) {}
}
