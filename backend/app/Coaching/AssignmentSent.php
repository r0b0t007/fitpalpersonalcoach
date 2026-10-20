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
 * Node pushed each member a notification in their own language at this point (assignmentPush);
 * the push is R3's, as a queued job listening here. Until then nobody listens and a member finds
 * the offer the next time they open the app, which is what Node did for anyone without push.
 */
final class AssignmentSent implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    /** @param  list<string>  $memberIds */
    public function __construct(public readonly User $coach, public readonly array $memberIds) {}
}
