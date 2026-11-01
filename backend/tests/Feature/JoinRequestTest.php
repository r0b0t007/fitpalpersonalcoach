<?php

// Asking to join a coach (CHW-336, spec §3, §3.0, §3.2): the intake, the emailed code, and a
// pending request — with no account and no seat until the coach accepts (CHW-337).

use App\Coaching\Intake;
use App\Mail\JoinCodeMail;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\LoginLink;
use App\Models\User;
use App\Support\ClientSafe;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
});

function intake(array $over = []): array
{
    return $over + ['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => '', 'equipment' => ['gym'], 'phone' => '', 'consent' => true];
}

it('keeps the intake to what the form offers, and stamps the consent', function () {
    $i = Intake::from((object) intake(['injuries' => '  Genou droit  ', 'equipment' => ['gym', 'home', 'gym', 'rocket'], 'phone' => '+212 612 345 678']));
    expect($i)->toMatchArray(['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => 'Genou droit', 'equipment' => ['gym', 'home'], 'phone' => '212612345678'])
        ->and($i['consent_at'])->toBeInt();
});

it('says what is missing from an intake', function (array $over, string $error) {
    expect(fn () => Intake::from((object) intake($over)))->toThrow(ClientSafe::class, $error);
})->with([
    'no goal' => [['goal' => 'fly'], 'tell us your goal, level and days a week'],
    'no level' => [['level' => ''], 'tell us your goal, level and days a week'],
    'days out of range' => [['days' => 9], 'tell us your goal, level and days a week'],
    'days as text' => [['days' => '3'], 'tell us your goal, level and days a week'],
    'no consent' => [['consent' => false], 'please agree to share your answers with your coach'],
    'bad phone' => [['phone' => '0612345678'], 'that is not a phone number — include the country code'],
    'long injuries' => [['injuries' => str_repeat('a', 501)], 'tell us your goal, level and days a week'],
]);

it('refuses an intake that is not an object', function () {
    expect(fn () => Intake::from('nope'))->toThrow(ClientSafe::class, 'tell us your goal, level and days a week');
});

/** An open page for coach A, as the editor saves it. */
function joinPage(object $coach, bool $open = true): void
{
    Coaching::own(new CoachPage, $coach, ['handle' => 'sara.fit', 'bio' => '', 'whatsapp' => '', 'open' => $open, 'theme' => 'dark', 'created' => 1, 'updated' => 1]);
}

function startJoin(array $over = [])
{
    return test()->postJson('/api/join/start', $over + ['handle' => 'sara.fit', 'name' => 'Salma', 'email' => 'Salma@Example.com', 'lang' => 'fr', 'intake' => intake(), 'website' => '', 'elapsed' => 9000]);
}

/** The code the last join mail to $to carried. */
function mailedCode(string $to): string
{
    return Mail::sent(JoinCodeMail::class, fn (JoinCodeMail $m) => $m->hasTo($to))->last()->code;
}

beforeEach(function () {
    Mail::fake();
    RateLimiter::clear('join:ip:127.0.0.1');
});

it('stores an unverified request and mails a code, with no account made', function () {
    joinPage($this->f->a);
    $users = User::query()->count();
    $res = startJoin()->assertOk();
    $req = JoinRequest::acrossCoaches()->find($res->json('id')); // across coaches: the test reads the row the public route wrote
    expect($req)->not->toBeNull()
        ->and($req->only(['coach_id', 'email', 'name', 'status', 'attempts']))->toBe(['coach_id' => $this->f->a->id, 'email' => 'salma@example.com', 'name' => 'Salma', 'status' => 'unverified', 'attempts' => 0])
        ->and(json_decode($req->intake, true))->toMatchArray(['goal' => 'strength', 'days' => 3])
        ->and(User::query()->count())->toBe($users);
    $code = mailedCode('salma@example.com');
    expect($code)->toMatch('/^\d{6}$/')->and($req->code_hash)->toBe(JoinRequest::hash($code));
    $mail = Mail::sent(JoinCodeMail::class)->last();
    expect($mail->lang)->toBe('fr')->and($mail->words['heading'])->toContain($code);
    $this->assertDatabaseHas('audit_events', ['ev' => 'join.request', 'msg' => 'sara.fit']);
    $this->assertDatabaseMissing('audit_events', ['ev' => 'join.request', 'name' => 'salma@example.com']);
});

it('answers a bot exactly as a person, and keeps nothing', function (array $over) {
    joinPage($this->f->a);
    startJoin($over)->assertOk()->assertJsonStructure(['ok', 'id']);
    expect(JoinRequest::acrossCoaches()->count())->toBe(0); // across coaches: test counts every row
    Mail::assertNothingSent();
})->with([
    'honeypot filled' => [['website' => 'http://spam.example']],
    'filled in under 3 s' => [['elapsed' => 900]],
]);

it('refuses a page that is closed or missing, as the page itself says', function () {
    startJoin()->assertStatus(404)->assertExactJson(['error' => 'no such coach page']);
    joinPage($this->f->a, open: false);
    startJoin()->assertStatus(404)->assertExactJson(['error' => 'this coach is not taking requests right now']);
});

it('says what is wrong with the name, the address or the intake', function (array $over, string $error) {
    joinPage($this->f->a);
    startJoin($over)->assertStatus(400)->assertExactJson(['error' => $error]);
    expect(JoinRequest::acrossCoaches()->count())->toBe(0); // across coaches: test counts every row
})->with([
    'no name' => [['name' => '  '], 'tell us your name'],
    'bad address' => [['email' => 'salma@'], 'that is not an email address'],
    'no consent' => [['intake' => intake(['consent' => false])], 'please agree to share your answers with your coach'],
]);

it('starts a request again rather than piling up unverified ones', function () {
    joinPage($this->f->a);
    $first = startJoin()->json('id');
    $second = startJoin()->json('id');
    expect(JoinRequest::acrossCoaches()->pluck('id')->all())->toBe([$second]) // across coaches: test reads every row
        ->and($first)->not->toBe($second);
});

it('turns requests away once a coach has 50 waiting', function () {
    joinPage($this->f->a);
    foreach (range(1, JoinRequest::MAX_PENDING) as $i) {
        Coaching::own(new JoinRequest, $this->f->a, ['id' => JoinRequest::newId(), 'email' => "p$i@example.com", 'name' => "P$i", 'intake' => '{}', 'status' => 'pending', 'created' => 1]);
    }
    startJoin()->assertStatus(429)->assertExactJson(['error' => 'this coach has too many requests waiting — try again later']);
});

it('stops one address, and one place, from sending code after code', function () {
    joinPage($this->f->a);
    foreach (range(1, 3) as $i) {
        startJoin()->assertOk();
    }
    startJoin()->assertOk();   // throttled, and answered as if it were not
    Mail::assertSentCount(3);
    $this->assertDatabaseHas('audit_events', ['ev' => 'join.request.throttled']);
});

/** Start a request and return [id, code]. */
function startedJoin(array $over = []): array
{
    $id = startJoin($over)->assertOk()->json('id');

    return [$id, mailedCode(LoginLink::normaliseEmail($over['email'] ?? 'Salma@Example.com'))];
}

function verifyJoin(string $id, string $code)
{
    return test()->postJson('/api/join/verify', ['id' => $id, 'code' => $code]);
}

it('makes the request pending on the right code, and gives the browser a token — still no account', function () {
    joinPage($this->f->a);
    $users = User::query()->count();
    [$id, $code] = startedJoin();
    $res = verifyJoin($id, $code)->assertOk()->assertJsonPath('status', 'pending');
    $token = $res->json('token');
    expect($token)->toMatch('/^[0-9a-f]{64}$/');
    $req = JoinRequest::acrossCoaches()->find($id); // across coaches: the test reads the row the public route wrote
    expect($req->only(['status', 'code_hash', 'token_hash']))->toBe(['status' => 'pending', 'code_hash' => null, 'token_hash' => JoinRequest::hash($token)])
        ->and(User::query()->count())->toBe($users);
    $this->assertDatabaseHas('audit_events', ['ev' => 'join.verify', 'msg' => 'sara.fit']);
    // The code is spent: a second go finds nothing to prove.
    verifyJoin($id, $code)->assertStatus(400)->assertExactJson(['error' => 'that code has expired — ask for a new one']);
});

it('counts wrong codes, and stops at five', function () {
    joinPage($this->f->a);
    [$id, $code] = startedJoin();
    $wrong = $code === '000000' ? '111111' : '000000';
    foreach (range(1, JoinRequest::MAX_ATTEMPTS) as $i) {
        verifyJoin($id, $wrong)->assertStatus(400)->assertExactJson(['error' => 'that code is wrong — check the email and try again']);
    }
    verifyJoin($id, $code)->assertStatus(429)->assertExactJson(['error' => 'too many tries — request a new code']);
});

it('lets a code lapse after 15 minutes, and knows no made-up request', function () {
    joinPage($this->f->a);
    [$id, $code] = startedJoin();
    $this->travel(JoinRequest::CODE_MINUTES + 1)->minutes();
    verifyJoin($id, $code)->assertStatus(400)->assertExactJson(['error' => 'that code has expired — ask for a new one']);
    verifyJoin('nope', '123456')->assertStatus(400)->assertExactJson(['error' => 'that code has expired — ask for a new one']);
});

it('stops a coach asking to join their own page', function () {
    joinPage($this->f->a);
    $this->f->a->forceFill(['email' => 'coach.a@example.com'])->save();
    [$id, $code] = startedJoin(['email' => 'Coach.A@example.com']);
    verifyJoin($id, $code)->assertStatus(400)->assertExactJson(['error' => 'that is your own page']);
});

it('keeps one waiting request per person and coach', function () {
    joinPage($this->f->a);
    [$id, $code] = startedJoin();
    verifyJoin($id, $code)->assertOk();
    [$again, $code2] = startedJoin();
    verifyJoin($again, $code2)->assertStatus(409)->assertExactJson(['error' => 'you already asked to join this coach']);
    expect(JoinRequest::acrossCoaches()->pluck('id')->all())->toBe([$id]); // across coaches: test reads every row
});

it('tells the browser holding the token where its request stands, and nobody else', function () {
    joinPage($this->f->a);
    [$id, $code] = startedJoin();
    $token = verifyJoin($id, $code)->json('token');
    $this->getJson("/api/join/status?id=$id&token=$token")->assertOk()
        ->assertExactJson(['status' => 'pending', 'coachName' => 'Coach A', 'handle' => 'sara.fit']);
    $this->getJson("/api/join/status?id=$id&token=".str_repeat('0', 64))->assertStatus(404)->assertExactJson(['error' => 'no such request']);
    $this->getJson("/api/join/status?id=$id")->assertStatus(404);
});
