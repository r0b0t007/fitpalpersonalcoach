<?php

// The coach's clients (CHW-246): GET /api/coach/members, GET /api/coach/member, POST
// /api/coach/member/release. The api/coach-smoke.sh sections they carry are named as there.

use App\Coaching\MemberCard;
use App\Models\Assignment;
use App\Models\User;
use App\Models\UserState;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
});

function stateOf(string $uid, array|string $state): void
{
    UserState::query()->create(['user_id' => $uid, 'state' => is_string($state) ? $state : json_encode($state), 'ts' => 1]);
}

function ids(array $members): array
{
    return array_column($members, 'id');
}

it('== role gating ==', function () {
    $this->getJson('/api/coach/members', bearer($this->f->a1))->assertStatus(403)->assertExactJson(['error' => 'forbidden']);   // member
    $this->getJson('/api/coach/members')->assertStatus(401)->assertExactJson(['error' => 'not signed in']);                    // anonymous
    $this->getJson('/api/coach/members', bearer($this->f->a))->assertOk();                                                      // coach
});

it('== roster scoping ==', function () {
    $f = $this->f;
    // A coach: their own active clients, oldest first. Not the disabled d1, not B's, not u1.
    $a = $this->getJson('/api/coach/members', bearer($f->a))->assertOk()->json();
    expect(ids($a['members']))->toBe([$f->a1->id, $f->a2->id])
        ->and($a['now'])->toBeInt();
    expect(ids($this->getJson('/api/coach/members', bearer($f->b))->json('members')))->toBe([$f->b1->id]);
    // An admin coaches everyone who is not disabled, coaches included — never themselves.
    $admin = ids($this->getJson('/api/coach/members', bearer($f->admin))->json('members'));
    expect($admin)->toEqualCanonicalizing([$f->a->id, $f->b->id, $f->a1->id, $f->a2->id, $f->b1->id, $f->u1->id]);
});

it('== reading a member ==', function () {
    $f = $this->f;
    $this->getJson('/api/coach/member?id='.$f->a1->id, bearer($f->a))->assertOk()->assertJsonPath('user.id', $f->a1->id);
    // One answer for every way of not being theirs, so nobody can enumerate accounts.
    foreach ([$f->b1->id, $f->u1->id, $f->d1->id, 'nope', ''] as $id) {
        $this->getJson('/api/coach/member?id='.$id, bearer($f->a))->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    }
    $this->getJson('/api/coach/member', bearer($f->a))->assertStatus(403);   // no id at all
    $this->getJson('/api/coach/member?id='.$f->b1->id, bearer($f->admin))->assertOk();
});

it('== releasing a client ==', function () {
    $f = $this->f;
    $post = fn ($who, $id) => $this->postJson('/api/coach/member/release', ['id' => $id], bearer($who));
    $post($f->a, $f->b1->id)->assertStatus(403)->assertExactJson(['error' => 'forbidden']);   // another's client
    $post($f->a, 'nobody0000000000')->assertStatus(403);                                    // nobody
    $post($f->a1, $f->a2->id)->assertStatus(403);                                           // a member

    // Their own: off the roster, unreadable, and A's pending offer goes with them. B's offer to
    // the same client is B's business and stays.
    $post($f->a, $f->a1->id)->assertOk()->assertExactJson(['ok' => true]);
    expect($f->a1->fresh()->coach_id)->toBeNull()
        ->and(Assignment::query()->find('assignA')->status)->toBe('expired')
        ->and(Assignment::query()->find('assignA')->decided_at)->toMatch('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/')
        ->and(Assignment::query()->find('assignBtoA1')->status)->toBe('pending');
    expect(ids($this->getJson('/api/coach/members', bearer($f->a))->json('members')))->toBe([$f->a2->id]);
    $this->getJson('/api/coach/member?id='.$f->a1->id, bearer($f->a))->assertStatus(403);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.member.release', 'uid' => $f->a->id, 'msg' => $f->a1->id]);

    // An admin releasing B's client expires B's offers — the member's coach, not the caller.
    $post($f->admin, $f->b1->id)->assertOk();
    expect($f->b1->fresh()->coach_id)->toBeNull()
        ->and(Assignment::query()->find('assignB')->status)->toBe('expired');
});

it('builds the card from the client\'s state, as Node\'s memberCard', function () {
    $f = $this->f;
    $today = gmdate('Y-m-d');
    $old = MemberCard::ADHERENCE_SEND_DAYS + 5;
    stateOf($f->a1->id, [
        '_ts' => 1715000000123,
        'workouts' => [['d' => gmdate('Y-m-d', strtotime("-$old days"))], ['d' => $today], ['d' => $today]],
        'routines' => [['id' => 'r1', 'ex' => [['id' => 'squat']]], ['id' => 'empty', 'ex' => []]],
        'week' => ['1' => 'r1'],
        'dayPlan' => [gmdate('Y-m-d', strtotime("-$old days")) => 'rest', $today => 'r1'],
        'checkins' => [['d' => '2026-05-10'], ['d' => '2026-05-03']],   // the newest filed, not the last entry
        'checkinDay' => 3.0,
    ]);
    Assignment::query()->whereKey('assignBtoA1')->update(['status' => 'declined', 'decided_at' => '2026-05-02T00:00:00.000Z']);

    $card = collect($this->getJson('/api/coach/members', bearer($f->a))->json('members'))->firstWhere('id', $f->a1->id);
    expect($card)->toMatchArray([
        'name' => 'Client A1', 'disabled' => false, 'workouts' => 3, 'lastWorkout' => $today,
        'lastSync' => 1715000000123, 'live' => null, 'lastCheckin' => '2026-05-10', 'checkinDay' => 3, 'routines' => 1,
        // B's decline shows (the client's history), but only A's own offer is A's to withdraw.
        'pending' => [['id' => 'assignA', 'created' => '2026-05-01T00:00:00.000Z', 'coachId' => $f->a->id]],
        'lastDecision' => ['status' => 'declined', 'at' => '2026-05-02T00:00:00.000Z'],
    ])->and($card['adherence'])->toBe([
        'week' => ['1' => 'r1'],
        'dayPlan' => [$today => 'r1'],          // trimmed to the window
        'routineIds' => ['r1'],                  // only routines that can be trained
        'trainedDays' => [$today],               // in the window, once
        'created' => $f->a1->createdIso(),
    ]);
});

it('keeps an empty object an object, and absent fields absent', function () {
    $f = $this->f;
    stateOf($f->a1->id, '{"week":{},"dayPlan":{},"mealDays":{},"routines":[{"id":"r1","name":"Push","ex":[]}]}');
    $raw = $this->getJson('/api/coach/member?id='.$f->a1->id, bearer($f->a))->assertOk()->getContent();
    expect($raw)->toContain('"week":{}')->toContain('"dayPlan":{}')->toContain('"mealDays":{}')
        // Node mapped { id, name, emoji } and dropped what the routine did not have.
        ->toContain('"routines":[{"id":"r1","name":"Push","count":0}]');
    $card = $this->getJson('/api/coach/members', bearer($f->a))->getContent();
    expect($card)->toContain('"adherence":{"week":{},"dayPlan":{}');
});

it('answers a client with no state yet with the defaults Node gave', function () {
    $f = $this->f;
    $this->getJson('/api/coach/member?id='.$f->a2->id, bearer($f->a))->assertOk()->assertExactJson([
        'user' => ['id' => $f->a2->id, 'name' => 'Client A2', 'created' => $f->a2->createdIso()],
        'unit' => 'kg', 'lastSync' => null, 'routines' => [], 'bodyweight' => [], 'measurements' => [],
        'checkins' => [], 'checkinDay' => null, 'meals' => [], 'mealDays' => [], 'nutriTarget' => null,
        'photos' => [], 'workouts' => [], 'body' => 'male', 'targetW' => null, 'effort' => null, 'showRir' => null,
        'week' => [], 'dayPlan' => [],
    ]);
});

it('sends at least one day more than the app\'s adherence window', function () {
    // frontend/src/lib/adherence.js scores ADHERENCE_WINDOW_DAYS on the browser's local date; this
    // trims on UTC, so it must send a day more than the app scores.
    $js = file_get_contents(base_path('../frontend/src/lib/adherence.js'));
    expect(preg_match('/export const ADHERENCE_WINDOW_DAYS = (\d+)/', $js, $m))->toBe(1)
        ->and(MemberCard::ADHERENCE_SEND_DAYS)->toBeGreaterThanOrEqual((int) $m[1] + 1);
});

it('picks an undated decision first and leaves out what Node left out', function () {
    $f = $this->f;
    // Node sorted String(decidedAt) descending: "undefined" before any ISO date. Its `at` was
    // undefined, so not in the JSON; nor was lastWorkout when the last workout had no `d`.
    Assignment::query()->whereKey('assignA')->update(['status' => 'accepted', 'decided_at' => null]);
    Assignment::query()->whereKey('assignBtoA1')->update(['status' => 'declined', 'decided_at' => '2026-05-02T00:00:00.000Z']);
    stateOf($f->a1->id, ['workouts' => [['d' => '2026-05-01'], ['note' => 'no date']]]);

    $card = collect($this->getJson('/api/coach/members', bearer($f->a))->json('members'))->firstWhere('id', $f->a1->id);
    expect($card['lastDecision'])->toBe(['status' => 'accepted'])
        ->and($card)->not->toHaveKey('lastWorkout')
        ->and($card['workouts'])->toBe(2);
});

it('lists accounts in Node\'s order: db.json position first, then accounts made here by date', function () {
    $f = $this->f;
    // Two undated legacy accounts whose ids sort the other way round from their db.json position.
    foreach ([['tZold00000000000', 0], ['tAold00000000000', 1]] as [$id, $pos]) {
        tap((new User)->forceFill(['id' => $id, 'name' => $id, 'coach_id' => $f->a->id, 'created_at' => null, 'legacy_order' => $pos]))->save();
    }
    expect(ids($this->getJson('/api/coach/members', bearer($f->a))->json('members')))
        ->toBe(['tZold00000000000', 'tAold00000000000', $f->a1->id, $f->a2->id]);
});
