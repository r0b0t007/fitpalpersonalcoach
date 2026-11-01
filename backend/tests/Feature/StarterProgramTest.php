<?php

// A coach's starter program and auto-accept (CHW-338): a request accepted, by the coach or by the
// page itself the moment the follower's code is checked, comes with the page's starter program as
// an `auto` offer, which the client's app takes in by itself so workout 1 is there the same day.

use App\Jobs\SendPush;
use App\Mail\JoinAnswerMail;
use App\Mail\JoinCodeMail;
use App\Models\Assignment;
use App\Models\CoachPage;
use App\Models\CoachProgram;
use App\Models\JoinRequest;
use App\Models\User;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Tests\Support\Coaching;

const STARTER_BUNDLE = ['opengym_plan' => 1, 'name' => 'Starter', 'week' => ['1' => ['r1'], '4' => ['r1']],
    'routines' => [['id' => 'r1', 'name' => 'Full body', 'ex' => [['id' => '0025', 'sets' => 3]]]], 'customEx' => []];

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0, 'fitpal.join_requests' => true]);
    $this->f = Coaching::twoCoaches();
    Mail::fake();
    Bus::fake([SendPush::class]);
    Coaching::own(new CoachProgram, $this->f->a, ['program_id' => 'starter-1', 'name' => 'Starter', 'bundle' => json_encode(STARTER_BUNDLE), 'created' => 1, 'updated' => 1]);
});

/** Coach A's open page, with these CHW-338 settings. */
function starterPage(object $coach, ?string $starter, bool $auto = false): void
{
    Coaching::own(new CoachPage, $coach, ['handle' => 'sara.fit', 'bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark',
        'starter_program_id' => $starter, 'auto_accept' => $auto, 'created' => 1, 'updated' => 1]);
}

/** A follower's request through the public form, its code checked: the verify response. */
function askAndVerify(string $email = 'salma@example.com')
{
    $id = test()->postJson('/api/join/start', ['handle' => 'sara.fit', 'name' => 'Salma', 'email' => $email, 'lang' => 'fr', 'hp' => '', 'elapsed' => 9000,
        'intake' => ['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => '', 'equipment' => ['gym'], 'phone' => '', 'consent' => true, 'over16' => true]])
        ->assertOk()->json('id');
    $code = Mail::sent(JoinCodeMail::class, fn (JoinCodeMail $m) => $m->hasTo($email))->last()->code;

    return test()->postJson('/api/join/verify', ['id' => $id, 'code' => $code]);
}

function starterInbox(User $member): array
{
    return test()->getJson('/api/assignments', bearer($member))->assertOk()->json('assignments');
}

it('saves the starter program and auto-accept with the page, and only a program of the coach\'s own', function () {
    $save = fn (array $more) => $this->postJson('/api/coach/page/save', $more + ['handle' => 'sara.fit', 'bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark'], bearer($this->f->a));
    $save(['starterProgramId' => 'starter-1', 'autoAccept' => true])->assertOk()
        ->assertJsonPath('page.starterProgramId', 'starter-1')->assertJsonPath('page.autoAccept', true);
    // Only a real true turns auto-accept on; an empty choice clears the starter.
    $save(['starterProgramId' => '', 'autoAccept' => 'true'])->assertOk()
        ->assertJsonPath('page.starterProgramId', null)->assertJsonPath('page.autoAccept', false);
    Coaching::own(new CoachProgram, $this->f->b, ['program_id' => 'theirs', 'name' => 'B', 'bundle' => json_encode(STARTER_BUNDLE), 'created' => 1, 'updated' => 1]);
    foreach (['nope', 'theirs'] as $id) {
        $save(['starterProgramId' => $id])->assertStatus(404)->assertExactJson(['error' => 'no such program']);
    }
});

it('gives a client the starter program when the coach accepts, as an offer the app takes in by itself', function () {
    starterPage($this->f->a, 'starter-1');
    askAndVerify()->assertOk()->assertJsonPath('status', 'pending');
    $join = JoinRequest::acrossCoaches()->sole(); // across coaches: the one request in the test
    $this->postJson('/api/coach/requests/decide', ['id' => $join->id, 'accept' => true], bearer($this->f->a))->assertOk();
    $member = User::query()->where('email', 'salma@example.com')->sole();
    $offers = starterInbox($member);
    expect($offers)->toHaveCount(1)
        ->and($offers[0])->toMatchArray(['coachName' => 'Coach A', 'schedule' => true, 'auto' => true, 'note' => ''])
        ->and($offers[0]['bundle']['routines'][0]['name'])->toBe('Full body');
    Bus::assertDispatched(SendPush::class);
});

it('offers nothing without a starter, or when the program is gone, and the accept stands', function (?string $starter) {
    starterPage($this->f->a, $starter);
    askAndVerify();
    $this->postJson('/api/coach/requests/decide', ['id' => JoinRequest::acrossCoaches()->sole()->id, 'accept' => true], bearer($this->f->a))->assertOk(); // across coaches: the one request in the test
    expect(starterInbox(User::query()->where('email', 'salma@example.com')->sole()))->toBe([]);
})->with(['no starter' => [null], 'deleted program' => ['deleted-since']]);

it('accepts by itself the moment the code is checked, when the page says so', function () {
    starterPage($this->f->a, 'starter-1', auto: true);
    askAndVerify()->assertOk()->assertJsonPath('status', 'accepted')->assertJsonStructure(['token']);
    $member = User::query()->where('email', 'salma@example.com')->sole();
    expect($member->coach_id)->toBe($this->f->a->id)
        ->and(starterInbox($member)[0]['auto'])->toBeTrue()
        ->and(Assignment::forMember($member->id)->sole()->coach_id)->toBe($this->f->a->id);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.request.auto', 'uid' => $member->id, 'msg' => 'sara.fit']);
    Mail::assertSent(JoinAnswerMail::class, fn (JoinAnswerMail $m) => $m->hasTo('salma@example.com'));
});

it('leaves the request waiting for the coach when their plan is full, and tells them', function () {
    config(['fitpal.free_cap' => 2]);   // A has two active clients already
    starterPage($this->f->a, 'starter-1', auto: true);
    askAndVerify()->assertOk()->assertJsonPath('status', 'pending');
    expect(User::query()->where('email', 'salma@example.com')->exists())->toBeFalse()
        ->and(JoinRequest::acrossCoaches()->sole()->status)->toBe('pending'); // across coaches: the one request in the test
    Bus::assertDispatched(SendPush::class, fn (SendPush $p) => $p->kind === 'join-request');
});
