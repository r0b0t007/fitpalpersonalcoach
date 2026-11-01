<?php

// What a follower told a coach when they asked to join — injuries (health data, GDPR art. 9 and
// Morocco law 09-08), a WhatsApp number — lasts as long as the link to that coach (CHW-334). Every
// path that ends the link forgets it, each tested here; and only that coach ever reads it.

use App\Admin\Accounts;
use App\Models\JoinRequest;
use App\Models\User;
use App\Tenancy\Detach;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
    Mail::fake();
});

/** $coach accepts a request from $email through the inbox; returns [request id, the follower]. */
function acceptedFollower(object $coach, string $email = 'salma@example.com'): array
{
    [$join] = pendingRequest($coach, $email);
    $member = decideRequest($coach, $join->id, true)->assertOk()->json('member.id');

    return [$join->id, User::query()->find($member)];
}

/** Whether a request row is still there, read as prune would: across every coach. */
function requestKept(string $id): bool
{
    return JoinRequest::acrossCoaches()->whereKey($id)->exists(); // across coaches: the test checks the row itself, whoever owns it
}

it('records the account accept made, so a later change of address cannot hide the request', function () {
    [$id, $member] = acceptedFollower($this->f->a);
    expect(JoinRequest::acrossCoaches()->find($id)->member_id)->toBe($member->id); // across coaches: the test reads the row the inbox wrote
});

it('forgets the intake when the coach releases the client — found by account, after a new address', function () {
    [$id, $member] = acceptedFollower($this->f->a);
    $member->forceFill(['email' => 'new@example.com'])->save();
    // The same follower asked coach B too: B's request is B's, and stays.
    [$atB] = pendingRequest($this->f->b);
    $this->postJson('/api/coach/member/release', ['id' => $member->id], bearer($this->f->a))->assertOk();
    expect(requestKept($id))->toBeFalse()->and(requestKept($atB->id))->toBeTrue();
});

it('forgets the intake when an admin takes the client off the roster, or moves them to another coach', function (bool $move) {
    [$id, $member] = acceptedFollower($this->f->a);
    $request = Request::create('/api/admin/assign', 'POST');
    Accounts::assignCoach($request, $this->f->admin, $member->id, $move ? $this->f->b->id : '');
    expect(requestKept($id))->toBeFalse();
})->with(['unassign' => false, 'move' => true]);

it('keeps the intake when an admin assigns the client to the coach they already have', function () {
    [$id, $member] = acceptedFollower($this->f->a);
    Accounts::assignCoach(Request::create('/api/admin/assign', 'POST'), $this->f->admin, $member->id, $this->f->a->id);
    expect(requestKept($id))->toBeTrue();
});

it('forgets every request a coach holds when they can no longer coach', function (string $how) {
    [$accepted] = acceptedFollower($this->f->a);
    [$waiting] = pendingRequest($this->f->a, 'two@example.com', 'Two');
    [$atB] = pendingRequest($this->f->b, 'b@example.com', 'B');
    $request = Request::create('/api/admin', 'POST');
    match ($how) {
        'disabled' => Accounts::disable($request, $this->f->admin, $this->f->a->id, true),
        'role removed' => Accounts::setCoach($request, $this->f->admin, $this->f->a->id, false),
        'detach' => Detach::coach($this->f->a),
    };
    expect(requestKept($accepted))->toBeFalse()->and(requestKept($waiting->id))->toBeFalse()->and(requestKept($atB->id))->toBeTrue();
})->with(['disabled', 'role removed', 'detach']);

it('shows a request only to the coach it was sent to', function () {
    pendingRequest($this->f->a);
    $this->getJson('/api/coach/requests', bearer($this->f->b))->assertOk()->assertExactJson(['requests' => []]);
    $this->getJson('/api/coach/requests/count', bearer($this->f->b))->assertOk()->assertExactJson(['pending' => 0]);
    $this->getJson('/api/coach/requests', bearer($this->f->a))->assertOk()->assertJsonCount(1, 'requests');
});

it('keeps the answers in the inbox only while they are needed: waiting, or accepted', function () {
    acceptedFollower($this->f->a);
    [$no] = pendingRequest($this->f->a, 'no@example.com', 'No');
    decideRequest($this->f->a, $no->id, false)->assertOk();
    pendingRequest($this->f->a, 'wait@example.com', 'Wait');
    $by = collect($this->getJson('/api/coach/requests', bearer($this->f->a))->json('requests'))->keyBy('status');
    expect($by['pending']['intake']['injuries'])->toBe('Genou')
        ->and($by['accepted']['intake']['injuries'])->toBe('Genou')
        ->and($by['declined']['intake'])->toBe([]);
});
