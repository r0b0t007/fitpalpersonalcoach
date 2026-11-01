<?php

// Asking to join a coach (CHW-336, spec §3, §3.0, §3.2): the intake, the emailed code, and a
// pending request — with no account and no seat until the coach accepts (CHW-337).

use App\Coaching\Intake;
use App\Mail\JoinCodeMail;
use App\Models\CoachPage;
use App\Models\JoinRequest;
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
