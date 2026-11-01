<?php

// Programs a coach sends and a client answers (CHW-249): POST /api/coach/assign, POST
// /api/coach/assignments/withdraw, GET /api/assignments, GET /api/assignments/history, POST
// /api/assignments/decide. Test names starting with "==" are the api/coach-smoke.sh sections of
// the same name.

use App\Coaching\AssignmentSent;
use App\Models\Assignment;
use App\Models\User;
use App\Support\Js;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
});

const BUNDLE = ['opengym_plan' => 1, 'name' => 'Block A', 'week' => ['1' => ['r1']], 'routines' => [['id' => 'r1', 'name' => 'Push', 'ex' => [['id' => '0025', 'sets' => 3]]]], 'customEx' => []];

function send(User $coach, array $memberIds, array $more = []): TestResponse
{
    return test()->postJson('/api/coach/assign', $more + ['memberIds' => $memberIds, 'bundle' => BUNDLE, 'note' => 'go'], bearer($coach));
}

function inbox(User $who): array
{
    return test()->getJson('/api/assignments', bearer($who))->assertOk()->json('assignments');
}

function decide(User $who, string $id, mixed $accept): TestResponse
{
    return test()->postJson('/api/assignments/decide', ['id' => $id, 'accept' => $accept], bearer($who));
}

function withdraw(User $who, string $id): TestResponse
{
    return test()->postJson('/api/coach/assignments/withdraw', ['id' => $id], bearer($who));
}

it('== assigning ==', function () {
    $f = $this->f;
    send($f->a, [$f->a2->id])->assertOk()->assertExactJson(['ok' => true, 'sent' => 1]);
    send($f->a, [$f->b1->id])->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    send($f->a, [$f->d1->id])->assertStatus(403);
    send($f->a, [$f->a2->id, $f->b1->id])->assertStatus(403);              // refused wholesale…
    expect(inbox($f->a2))->toHaveCount(1);                                   // …nothing written
    send($f->a, [])->assertStatus(400)->assertExactJson(['error' => 'pick at least one member']);
    $this->postJson('/api/coach/assign', ['memberIds' => [$f->a2->id], 'bundle' => ['nope' => 1]], bearer($f->a))
        ->assertStatus(400)->assertExactJson(['error' => 'not a plan bundle']);
    send($f->a, [$f->a2->id, $f->a2->id])->assertOk()->assertJsonPath('sent', 1);   // a Set
    send($f->a1, [$f->a2->id])->assertStatus(403);                                  // a member
});

it('checks the bundle before the members, as Node did', function () {
    $this->postJson('/api/coach/assign', ['memberIds' => [], 'bundle' => 'x'], bearer($this->f->a))
        ->assertStatus(400)->assertExactJson(['error' => 'plan required']);
});

it('== nutrition targets on the bundle ==', function () {
    $f = $this->f;
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['nutrition' => ['kcal' => 2200, 'p' => 170, 'note' => 'rest days']]])->assertOk();
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['nutrition' => ['kcal' => 'lots']]])->assertStatus(400);
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['nutrition' => ['kcal' => 999999]]])->assertStatus(400);
    $raw = $this->getJson('/api/assignments', bearer($f->a2))->getContent();
    expect($raw)->toContain('"nutrition":{"kcal":2200,"p":170,"note":"rest days"}');   // c and f absent
});

it('== the member\'s inbox ==', function () {
    $f = $this->f;
    expect(array_column(inbox($f->a1), 'id'))->toBe(['assignA', 'assignBtoA1'])   // every coach's
        ->and(inbox($f->a2))->toBe([]);
    decide($f->a2, 'assignA', true)->assertStatus(404)->assertExactJson(['error' => 'no such assignment']);
    decide($f->a, 'assignA', true)->assertStatus(404);
    decide($f->a1, 'assignA', true)->assertOk()->assertExactJson(['ok' => true, 'status' => 'accepted']);
    decide($f->a1, 'assignA', true)->assertStatus(409)->assertExactJson(['error' => 'already decided']);
    expect(array_column(inbox($f->a1), 'id'))->toBe(['assignBtoA1']);
});

it('shows the inbox in Node\'s shape: the bundle as sent, schedule a boolean', function () {
    $f = $this->f;
    send($f->a, [$f->a2->id], ['note' => '  hi  ', 'schedule' => 1, 'bundle' => ['week' => new stdClass] + BUNDLE])->assertOk();
    $row = inbox($f->a2)[0];
    expect($row)->toHaveKeys(['id', 'coachName', 'note', 'created', 'schedule', 'auto', 'bundle'])->toHaveCount(7)
        ->and($row['auto'])->toBeFalse()   // a program the coach sent, not a page's starter (CHW-338)
        ->and($row['id'])->toMatch('/^[A-Za-z0-9_-]{16}$/')
        ->and($row['coachName'])->toBe('Coach A')
        ->and($row['note'])->toBe('hi')
        ->and($row['schedule'])->toBeTrue()
        ->and($row['created'])->toMatch('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/');
    expect($this->getJson('/api/assignments', bearer($f->a2))->getContent())->toContain('"week":{}');
    $this->getJson('/api/assignments')->assertStatus(401);
});

it('== the server must NOT have touched member state ==', function () {
    send($this->f->a, [$this->f->a2->id])->assertOk();
    decide($this->f->a2, inbox($this->f->a2)[0]['id'], true)->assertOk();
    expect(DB::table('user_states')->where('user_id', $this->f->a2->id)->exists())->toBeFalse();
});

it('caps a member\'s inbox at 5, counting every coach\'s offers', function () {
    $f = $this->f;
    // a1 already holds one offer from A and one from B.
    send($f->a, [$f->a1->id])->assertOk();
    send($f->a, [$f->a1->id])->assertOk();
    send($f->a, [$f->a1->id])->assertOk();
    send($f->a, [$f->a2->id, $f->a1->id])->assertStatus(429)->assertExactJson([
        'error' => 'Client A1 already has 5 programs waiting',
        'msg' => ['k' => '{0} already has {1} programs waiting', 'v' => ['Client A1', 5]],
    ]);
    expect(inbox($f->a2))->toBe([]);   // all or nothing
});

it('== withdrawing a program sent by mistake ==', function () {
    $f = $this->f;
    withdraw($f->b, 'assignA')->assertStatus(404)->assertExactJson(['error' => 'no such assignment']);
    withdraw($f->a1, 'assignA')->assertStatus(403);
    withdraw($f->a, 'assignA')->assertOk()->assertExactJson(['ok' => true]);
    expect(array_column(inbox($f->a1), 'id'))->toBe(['assignBtoA1']);
    withdraw($f->a, 'assignA')->assertStatus(409)->assertExactJson(['error' => 'already decided']);
    expect(Assignment::query()->find('assignA')->decided_at)->toMatch('/Z$/');
    $this->postJson('/api/coach/assignments/withdraw', ['id' => ['assignA']], bearer($f->a))->assertStatus(404);
});

it('== the coach can finally see what happened ==', function () {
    $f = $this->f;
    decide($f->a1, 'assignA', false)->assertOk()->assertJsonPath('status', 'declined');
    $card = collect($this->getJson('/api/coach/members', bearer($f->a))->json('members'))->firstWhere('id', $f->a1->id);
    expect($card['lastDecision']['status'])->toBe('declined')
        ->and($card['pending'])->toBe([]);   // B's offer is B's to see
});

it('== moving a member\'s check-in day rides the plan bundle ==', function () {
    $f = $this->f;
    $day = fn () => (array) collect(inbox($f->a2))->last()['bundle'];
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['checkinDay' => 3]])->assertOk();
    expect($day()['checkinDay'])->toBe(3);
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['checkinDay' => 0]])->assertOk();
    expect($day()['checkinDay'])->toBe(0);
    send($f->a, [$f->a2->id])->assertOk();
    expect($day())->not->toHaveKey('checkinDay');
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['checkinDay' => 9]])->assertStatus(400);
    send($f->a, [$f->a2->id], ['bundle' => BUNDLE + ['checkinDay' => []]])->assertStatus(400);
});

it('== what a client can see about programs they already answered ==', function () {
    $f = $this->f;
    $this->getJson('/api/assignments/history')->assertStatus(401);
    $hist = fn (User $u) => $this->getJson('/api/assignments/history', bearer($u))->assertOk()->json('assignments');
    expect($hist($f->a2))->toBe([]);
    send($f->a, [$f->a2->id])->assertOk();
    expect($hist($f->a2))->toBe([]);                                   // pending is not history
    decide($f->a2, inbox($f->a2)[0]['id'], true)->assertOk();
    $row = $hist($f->a2)[0];
    expect($row)->toMatchArray(['status' => 'accepted', 'name' => 'Block A', 'routines' => 1, 'coachName' => 'Coach A', 'note' => 'go'])
        ->and($row)->not->toHaveKey('bundle')
        ->and($row['decidedAt'])->toMatch('/Z$/');
    expect($hist($f->a1))->toBe([]);                                   // not another's
    send($f->a, [$f->a2->id])->assertOk();
    withdraw($f->a, inbox($f->a2)[0]['id'])->assertOk();
    expect($hist($f->a2))->toHaveCount(1);                             // withdrawn is not history
});

it('orders the history by when each was answered, newest first', function () {
    $f = $this->f;
    $this->travelTo('2026-06-01T10:00:00Z');
    decide($f->a1, 'assignBtoA1', false)->assertOk();
    $this->travelTo('2026-06-02T10:00:00Z');
    decide($f->a1, 'assignA', true)->assertOk();
    expect(array_column($this->getJson('/api/assignments/history', bearer($f->a1))->json('assignments'), 'id'))
        ->toBe(['assignA', 'assignBtoA1']);
});

it('retires an offer whose coach no longer coaches the member when it is accepted', function () {
    $f = $this->f;
    // B's offer to A's client: B is not a1's coach, so accepting it is refused, and that sticks.
    decide($f->a1, 'assignBtoA1', true)->assertStatus(409)->assertExactJson(['error' => 'that program is no longer available']);
    expect(Assignment::query()->find('assignBtoA1')->status)->toBe('expired');
    decide($f->a1, 'assignBtoA1', false)->assertStatus(409)->assertExactJson(['error' => 'already decided']);
    // A disabled coach's offer goes the same way; declining one is still allowed.
    $f->a->forceFill(['disabled' => true])->save();
    decide($f->a1, 'assignA', true)->assertStatus(409);
});

it('lets a member decline an offer from a coach who has since lost them', function () {
    decide($this->f->a1, 'assignBtoA1', 0)->assertOk()->assertJsonPath('status', 'declined');
});

it('reads the body as Node\'s readBody did on every assignment route', function () {
    foreach ([[$this->f->a, '/api/coach/assign'], [$this->f->a, '/api/coach/assignments/withdraw'], [$this->f->a1, '/api/assignments/decide']] as [$who, $path]) {
        $this->call('POST', $path, [], [], [], $this->transformHeadersToServerVars(bearer($who) + ['Content-Type' => 'application/json']), '{nope')
            ->assertStatus(400)->assertExactJson(['error' => 'bad json']);
    }
});

it('leaves a seam for the push: one event per send, after the rows are written', function () {
    Event::fake([AssignmentSent::class]);
    send($this->f->a, [$this->f->a1->id, $this->f->a2->id])->assertOk();
    Event::assertDispatchedTimes(AssignmentSent::class, 1);
    Event::assertDispatched(AssignmentSent::class, fn (AssignmentSent $e) => $e->coach->is($this->f->a)
        && $e->memberIds === [$this->f->a1->id, $this->f->a2->id]);
    send($this->f->a, [$this->f->b1->id])->assertStatus(403);
    Event::assertDispatchedTimes(AssignmentSent::class, 1);
});

it('never announces a send its caller rolled back', function () {
    Event::fake([AssignmentSent::class]);
    DB::beginTransaction();
    send($this->f->a, [$this->f->a2->id])->assertOk();
    DB::rollBack();
    Event::assertNotDispatched(AssignmentSent::class);
    expect(inbox($this->f->a2))->toBe([]);
});

it('prunes hourly as pruneAssignments did: 30 days pending or answered, but never the program a member is on', function () {
    $f = $this->f;
    $row = fn (string $id, User $m, string $status, string $created, ?string $decided = null) => Coaching::own(new Assignment, $f->a,
        ['id' => $id, 'coach_name' => 'Coach A', 'member_id' => $m->id, 'bundle' => '{}', 'status' => $status, 'created' => $created, 'decided_at' => $decided]);
    $this->travelTo('2026-07-01T00:00:00Z');
    $row('oldPending', $f->a2, 'pending', '2026-05-31T23:59:59.999Z');
    $row('freshPending', $f->a2, 'pending', '2026-06-01T00:00:00.001Z');
    $row('oldDeclined', $f->a2, 'declined', '2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    $row('lateDecided', $f->a2, 'declined', '2026-01-01T00:00:00.000Z', '2026-06-15T00:00:00.000Z');
    $row('onIt', $f->a2, 'accepted', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z');
    $row('olderAccept', $f->a2, 'accepted', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    $row('garbage', $f->a2, 'declined', 'not a date', 'nor this');
    // V8 rolls a day past the month's end over: 2026-06-31 is July 1, so this one is fresh.
    $row('rolledOver', $f->a2, 'declined', '2026-01-01T00:00:00.000Z', '2026-06-31T00:00:00.000Z');
    expect(Assignment::prune())->toBe(7);
    expect(Assignment::acrossCoaches()->where('member_id', $f->a2->id)->orderBy('id')->pluck('id')->all()) // across coaches: test reads every row
        ->toBe(['freshPending', 'lateDecided', 'onIt', 'rolledOver'])
        // The fixture's offers are dated 2026-05-01, past the window too, whichever coach sent them.
        ->and(Assignment::acrossCoaches()->whereKey(['assignA', 'assignB', 'assignBtoA1'])->count())->toBe(0); // across coaches: test reads every row
    $task = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'fitpal:prune'));
    expect($task?->expression)->toBe('0 * * * *');
});

it('does not prune an offer that was accepted while the prune was deciding', function () {
    $this->travelTo('2026-07-01T00:00:00Z');
    // assignA is a pending offer from 2026-05-01: stale when prune reads it. Before its DELETE
    // runs, a1 accepts it (as decide would, from another request) — it is their program now.
    $raced = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$raced) {
        if (! $raced && str_starts_with(strtolower($sql), 'delete')) {
            $raced = true;
            DB::table('assignments')->where('id', 'assignA')->update(['status' => 'accepted', 'decided_at' => '2026-07-01T00:00:00.000Z']);
        }
    });
    Assignment::prune();
    expect($raced)->toBeTrue()
        ->and(Assignment::acrossCoaches()->find('assignA')?->status)->toBe('accepted'); // across coaches: test reads every row
});

it('parses timestamps as Date.parse did', function () {
    expect(Js::dateParse('2026-06-01T10:00:00.123Z'))->toBe(1780308000123)
        ->and(Js::dateParse('2026-06-01'))->toBe(1780272000000)
        ->and(Js::dateParse('2026-06-01T12:00+02:00'))->toBe(1780308000000)
        // V8 checks a day against 1-31 only and rolls the rest over: these are March 2 and May 1.
        ->and(Js::dateParse('2026-02-30'))->toBe(1772409600000)
        ->and(Js::dateParse('2026-04-31'))->toBe(1777593600000)
        ->and(Js::dateParse('2026-02-28T24:00:00Z'))->toBe(1772323200000)
        ->and(Js::dateParse('2026-02-32'))->toBeNull()
        ->and(Js::dateParse('2026-02-00'))->toBeNull()
        ->and(Js::dateParse('2026-13-01'))->toBeNull()
        ->and(Js::dateParse('2026-02-28T24:00:01Z'))->toBeNull()
        ->and(Js::dateParse(''))->toBeNull()
        ->and(Js::dateParse(null))->toBeNull();
});

it('locks the coach before the members, the order a detach takes them in', function () {
    $f = $this->f;
    $reads = [];
    DB::listen(function ($q) use (&$reads, $f) {
        if (str_starts_with($q->sql, 'select * from "users"') && DB::transactionLevel() >= 2) {
            $reads[] = in_array($f->a->id, $q->bindings, true) ? 'coach' : 'members';
        }
    });
    send($f->a, [$f->a1->id, $f->a2->id])->assertOk();
    expect(array_slice($reads, 0, 2))->toBe(['coach', 'members']);
});
