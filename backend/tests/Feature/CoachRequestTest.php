<?php

// The coach's requests inbox (CHW-337, spec §3, §3.0): accept makes the follower's account — the
// first moment one exists — on the coach's roster, behind the seat check; decline says no; and the
// follower's browser trades its token for a session once, after acceptance.

use App\Auth\SessionToken;
use App\Http\Controllers\CoachRequestController;
use App\Jobs\SendPush;
use App\Mail\AccountMail;
use App\Mail\JoinAnswerMail;
use App\Mail\JoinCodeMail;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\User;
use App\Support\ClientSafe;
use App\Tenancy\CoachContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
    Mail::fake();
});

/** A pending request to $coach, as verify leaves it; returns [request, token]. */
function pendingRequest(object $coach, string $email = 'salma@example.com', string $name = 'Salma'): array
{
    $token = bin2hex(random_bytes(32));
    $join = Coaching::own(new JoinRequest, $coach, [
        'id' => JoinRequest::newId(), 'email' => $email, 'name' => $name, 'status' => 'pending',
        'intake' => json_encode(['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => 'Genou', 'equipment' => ['gym'], 'phone' => '212612345678', 'consent_at' => 1]),
        'token_hash' => JoinRequest::hash($token), 'created' => 1_700_000_000_000,
    ]);

    return [$join, $token];
}

function decideRequest(object $coach, string $id, bool $accept)
{
    return test()->postJson('/api/coach/requests/decide', ['id' => $id, 'accept' => $accept], bearer($coach));
}

it('lists a coach their own requests, pending first, with the intake', function () {
    [$mine] = pendingRequest($this->f->a);
    pendingRequest($this->f->b, 'other@example.com', 'Other');
    $res = $this->getJson('/api/coach/requests', bearer($this->f->a))->assertOk();
    expect($res->json('requests'))->toHaveCount(1)
        ->and($res->json('requests.0'))->toMatchArray(['id' => $mine->id, 'name' => 'Salma', 'email' => 'salma@example.com', 'status' => 'pending'])
        ->and($res->json('requests.0.intake'))->toMatchArray(['goal' => 'strength', 'injuries' => 'Genou', 'phone' => '212612345678']);
    $this->getJson('/api/coach/requests', bearer($this->f->a1))->assertStatus(403);
});

it('accepts: the follower gets an account, on the roster, with a seat — and only then', function () {
    [$join] = pendingRequest($this->f->a);
    expect(User::query()->where('email', 'salma@example.com')->exists())->toBeFalse();
    decideRequest($this->f->a, $join->id, true)->assertOk()->assertJsonPath('member.name', 'Salma');
    $user = User::query()->where('email', 'salma@example.com')->first();
    expect($user->coach_id)->toBe($this->f->a->id)
        ->and($user->email_verified_at)->not->toBeNull()
        ->and($user->isCoach())->toBeFalse()
        ->and($join->refresh()->status)->toBe('accepted')
        ->and($join->decided)->not->toBeNull();
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.request.accept', 'uid' => $this->f->a->id]);
});

it('binds an account that already exists and has no coach', function () {
    $this->f->u1->forceFill(['email' => 'salma@example.com'])->save();
    [$join] = pendingRequest($this->f->a);
    decideRequest($this->f->a, $join->id, true)->assertOk();
    expect($this->f->u1->refresh()->coach_id)->toBe($this->f->a->id)
        ->and(User::query()->where('email', 'salma@example.com')->count())->toBe(1);
});

it('never moves a client between coaches: a second accept is refused and the request lapses', function () {
    [$atB] = pendingRequest($this->f->b);
    [$atA] = pendingRequest($this->f->a);
    decideRequest($this->f->b, $atB->id, true)->assertOk();
    decideRequest($this->f->a, $atA->id, true)->assertStatus(409)->assertExactJson(['error' => 'they already train with another coach']);
    expect(User::query()->where('email', 'salma@example.com')->first()->coach_id)->toBe($this->f->b->id)
        ->and($atA->refresh()->status)->toBe('expired');
});

it('keeps the request waiting when the plan is full, and says how to make room', function () {
    config(['fitpal.free_cap' => 2]);   // A has two active clients already
    [$join] = pendingRequest($this->f->a);
    decideRequest($this->f->a, $join->id, true)->assertStatus(402)->assertExactJson([
        'error' => 'your plan allows 2 clients — upgrade to accept more',
        'msg' => ['k' => 'your plan allows {0} clients — upgrade to accept more', 'v' => [2]],
    ]);
    expect($join->refresh()->status)->toBe('pending')
        ->and(User::query()->where('email', 'salma@example.com')->exists())->toBeFalse();
});

it('declines without making anything, and says nothing more to the follower than no', function () {
    [$join, $token] = pendingRequest($this->f->a);
    decideRequest($this->f->a, $join->id, false)->assertOk();
    expect($join->refresh()->status)->toBe('declined')
        ->and(User::query()->where('email', 'salma@example.com')->exists())->toBeFalse();
    $this->postJson('/api/join/status', ['id' => $join->id, 'token' => $token])->assertJsonPath('status', 'declined');
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.request.decline']);
});

it("answers a coach on another coach's request as on a made-up one", function () {
    [$join] = pendingRequest($this->f->b);
    decideRequest($this->f->a, $join->id, true)->assertStatus(404)->assertExactJson(['error' => 'no such request']);
    decideRequest($this->f->a, 'nope', false)->assertStatus(404);
    expect($join->refresh()->status)->toBe('pending');
});

it('stops a read-only coach accepting', function () {
    Billing::on();
    [$join] = pendingRequest($this->f->a);
    decideRequest($this->f->a, $join->id, true)->assertStatus(402);
});

it('lets the browser that sent an accepted request sign in — again if the answer was lost — for a week', function () {
    [$join, $token] = pendingRequest($this->f->a);
    $this->postJson('/api/join/claim', ['id' => $join->id, 'token' => $token])->assertStatus(404);   // not accepted yet
    decideRequest($this->f->a, $join->id, true)->assertOk();
    $res = $this->postJson('/api/join/claim', ['id' => $join->id, 'token' => $token])->assertOk()
        ->assertJsonPath('user.name', 'Salma')->assertJsonPath('user.coachName', 'Coach A');
    expect($res->getCookie(SessionToken::cookieName(), false)?->getValue())->not->toBeEmpty();
    $this->assertDatabaseHas('audit_events', ['ev' => 'join.claim']);
    // A claim whose answer never arrived (the network dropped) can be made again.
    $this->postJson('/api/join/claim', ['id' => $join->id, 'token' => $token])->assertOk();
    // A week after the accept the token signs in to nothing, and prune forgets it.
    $this->travel(JoinRequest::CLAIM_DAYS + 1)->days();
    $this->postJson('/api/join/claim', ['id' => $join->id, 'token' => $token])->assertStatus(404)->assertExactJson(['error' => 'no such request']);
    $this->artisan('fitpal:prune')->assertSuccessful();
    expect($join->refresh()->token_hash)->toBeNull();
});

it('reads accept as a yes or a no, and nothing else', function (mixed $accept) {
    [$join] = pendingRequest($this->f->a);
    $body = $accept === 'missing' ? ['id' => $join->id] : ['id' => $join->id, 'accept' => $accept];
    $this->postJson('/api/coach/requests/decide', $body, bearer($this->f->a))->assertStatus(400)->assertExactJson(['error' => 'accept must be true or false']);
    expect($join->refresh()->status)->toBe('pending');
})->with(['missing', 'true', 1, null]);

it('marks a request accepted when its follower is already on this roster', function () {
    $this->f->a1->forceFill(['email' => 'salma@example.com'])->save();
    [$join] = pendingRequest($this->f->a);
    decideRequest($this->f->a, $join->id, true)->assertOk()->assertJsonPath('member.id', $this->f->a1->id);
    expect($join->refresh()->status)->toBe('accepted');
});

it('says why an account cannot be put on the roster', function (array $fill, string $error) {
    $this->f->u1->forceFill(['email' => 'salma@example.com'] + $fill)->save();
    [$join] = pendingRequest($this->f->a);
    decideRequest($this->f->a, $join->id, true)->assertStatus(409)->assertExactJson(['error' => $error]);
    expect($join->refresh()->status)->toBe('expired');
})->with([
    'disabled' => [['disabled' => true], 'this account has been disabled'],
    'a coach' => [['coach' => true], 'that address belongs to a coach account'],
]);

it('judges the coach again on the locked row: an accept that waited behind a detach attaches nobody', function () {
    [$join] = pendingRequest($this->f->a);
    $stale = User::query()->find($this->f->a->id);
    User::query()->whereKey($stale->id)->update(['disabled' => true]);
    app(CoachContext::class)->set($stale);
    $request = Request::create('/api/coach/requests/decide', 'POST', server: ['CONTENT_TYPE' => 'application/json'], content: json_encode(['id' => $join->id, 'accept' => true]));
    $request->setUserResolver(fn () => $stale);
    expect(fn () => app(CoachRequestController::class)->decide($request))->toThrow(ClientSafe::class, 'not signed in')
        ->and(User::query()->where('email', 'salma@example.com')->exists())->toBeFalse();
});

it('tells the follower the answer, by email, in their language', function () {
    Coaching::own(new CoachPage, $this->f->a, ['handle' => 'sara.fit', 'bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark', 'created' => 1, 'updated' => 1]);
    [$yes] = pendingRequest($this->f->a);
    [$no] = pendingRequest($this->f->a, 'other@example.com', 'Other');
    $no->forceFill(['lang' => 'es'])->save();
    $yes->forceFill(['lang' => 'fr'])->save();
    decideRequest($this->f->a, $yes->id, true)->assertOk();
    decideRequest($this->f->a, $no->id, false)->assertOk();
    Mail::assertSent(JoinAnswerMail::class, fn (JoinAnswerMail $m) => $m->hasTo('salma@example.com') && $m->accepted && $m->lang === 'fr' && $m->url === 'https://coach.example/#/join/sara.fit');
    Mail::assertSent(JoinAnswerMail::class, fn (JoinAnswerMail $m) => $m->hasTo('other@example.com') && ! $m->accepted && $m->lang === 'es');
});

it('counts the waiting requests without sending them', function () {
    pendingRequest($this->f->a);
    pendingRequest($this->f->a, 'two@example.com', 'Two');
    pendingRequest($this->f->b, 'b@example.com', 'B');
    $this->getJson('/api/coach/requests/count', bearer($this->f->a))->assertOk()->assertExactJson(['pending' => 2]);
});

it('tells the coach a request has arrived, by push and by email', function () {
    Bus::fake([SendPush::class]);
    $this->f->a->forceFill(['email' => 'coach.a@example.com', 'email_verified_at' => now()])->save();
    Coaching::own(new CoachPage, $this->f->a, ['handle' => 'sara.fit', 'bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark', 'created' => 1, 'updated' => 1]);
    $id = $this->postJson('/api/join/start', ['handle' => 'sara.fit', 'name' => 'Salma', 'email' => 'salma@example.com', 'lang' => 'fr', 'hp' => '', 'elapsed' => 9000,
        'intake' => ['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => '', 'equipment' => [], 'phone' => '', 'consent' => true, 'over16' => true]])->json('id');
    $code = Mail::sent(JoinCodeMail::class)->last()->code;
    $this->postJson('/api/join/verify', ['id' => $id, 'code' => $code])->assertOk();
    Bus::assertDispatched(SendPush::class, fn (SendPush $j) => $j->userId === $this->f->a->id && $j->kind === 'join-request' && $j->args === ['Salma']);
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'request' && $m->hasTo('coach.a@example.com') && str_contains((string) $m->url, '/#/requests'));
});

it('renders the answer mails, the accept with its button and the decline without', function () {
    $yes = (new JoinAnswerMail(true, 'Coach A', 'fr', 'https://coach.example/#/join/sara.fit'))->render();
    expect($yes)->toContain('Coach A vous a accepté')->toContain('https://coach.example/#/join/sara.fit')->toContain('Commencer à m’entraîner');
    $no = (new JoinAnswerMail(false, 'Coach A', 'es', 'https://coach.example/#/join/sara.fit'))->render();
    expect($no)->toContain('Esta vez no')->not->toContain('https://coach.example/#/join/sara.fit');
    expect((new JoinAnswerMail(false, 'Coach A', 'xx'))->lang)->toBe('en');
});
