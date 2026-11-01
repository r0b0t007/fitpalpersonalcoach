<?php

// The coach terms (CHW-357): the service and the Art. 28 processor agreement between each coach
// (the controller of their clients' data) and FitPal (the processor). A coach signing up accepts
// the current version; a coach from before accepts it once, in the app; both are recorded with the
// version and the time, so which text a coach agreed to is never in doubt.

use App\Coaching\Terms;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Support\Billing;
use Tests\Support\Coaching;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173',
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
        'fitpal.session_secret' => str_repeat('ab', 32),
        'fitpal.self_serve_coach' => true, 'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '', 'fitpal.free_cap' => 3,
    ]);
    Mail::fake();
    $this->f = Coaching::twoCoaches();
});

/** A self-serve sign-up, with the current terms unless the body says otherwise. */
function termsSignup(array $body): TestResponse
{
    $options = test()->postJson('/api/register/options', $body + ['coach' => true, 'terms' => Terms::VERSION]);
    if ($options->status() !== 200) {
        return $options;
    }

    return test()->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => (new Passkey)->attest($options->json('options'))]);
}

it('tells the app which version of the terms is current', function () {
    $this->getJson('/api/config')->assertOk()->assertJsonPath('terms_version', Terms::VERSION);
});

it('signs up a coach without the current terms all the same, and asks for them in the app', function (array $body) {
    // An app from before the terms, or a Start tab open across a new version.
    $id = termsSignup(['name' => 'Nadia', 'email' => 'nadia@example.com'] + $body)->assertOk()->json('user.id');
    $user = User::query()->find($id);
    expect($user->terms_version)->toBeNull()->and($user->terms_at)->toBeNull();
    $this->getJson('/api/coach/terms', bearer($user))->assertOk()->assertJsonPath('accepted', false);
    $this->assertDatabaseMissing('audit_events', ['ev' => 'coach.terms.accept']);
})->with([
    'none' => [['terms' => '']],
    'an older version' => [['terms' => '2020-01-01']],
]);

it('holds a coach to an earlier version until a new one takes effect, then asks again', function () {
    $this->f->a->forceFill(['terms_version' => '2020-01-01', 'terms_at' => 1])->save();
    expect(Terms::accepted($this->f->a, Terms::effectiveMs() - 1))->toBeTrue()
        ->and(Terms::accepted($this->f->a, Terms::effectiveMs()))->toBeFalse();
    // Never accepted anything: asked at once, whatever the date.
    expect(Terms::accepted($this->f->b, Terms::effectiveMs() - 1))->toBeFalse();
});

it('keeps a version the database can hold, taking effect no earlier than it is published', function () {
    expect(Terms::VERSION)->toMatch('/^\d{4}-\d{2}-\d{2}$/')
        ->and(strlen(Terms::VERSION))->toBeLessThanOrEqual(32)
        ->and(Terms::EFFECTIVE >= Terms::VERSION)->toBeTrue();
});

it('records the version and the time a coach accepted at sign-up', function () {
    $id = termsSignup(['name' => 'Nadia', 'email' => 'nadia@example.com'])->assertOk()->json('user.id');
    $user = User::query()->find($id);
    expect($user->terms_version)->toBe(Terms::VERSION)
        ->and($user->terms_at)->toBeGreaterThan(1_700_000_000_000);
    $this->getJson('/api/coach/terms', bearer($user))->assertOk()
        ->assertExactJson(['version' => Terms::VERSION, 'accepted' => true, 'acceptedAt' => $user->terms_at, 'effective' => Terms::EFFECTIVE]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.terms.accept', 'msg' => Terms::VERSION]);
});

it('asks a coach from before the terms to accept them once, and records it', function () {
    $this->getJson('/api/coach/terms', bearer($this->f->a))->assertOk()
        ->assertExactJson(['version' => Terms::VERSION, 'accepted' => false, 'acceptedAt' => null, 'effective' => Terms::EFFECTIVE]);
    $this->postJson('/api/coach/terms', ['version' => Terms::VERSION], bearer($this->f->a))->assertOk()
        ->assertJsonPath('accepted', true);
    expect($this->f->a->refresh()->terms_version)->toBe(Terms::VERSION);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.terms.accept', 'msg' => Terms::VERSION]);
});

it('records no acceptance of a text the coach did not see', function () {
    $this->postJson('/api/coach/terms', ['version' => '2020-01-01'], bearer($this->f->a))
        ->assertStatus(409)->assertExactJson(['error' => 'these terms have changed — read them again']);
    expect($this->f->a->refresh()->terms_version)->toBeNull();
});

it('lets a coach on a lapsed plan accept, and keeps clients out', function () {
    Billing::on();   // every coach read-only: accepting the terms is not a write a plan stops
    $this->postJson('/api/coach/terms', ['version' => Terms::VERSION], bearer($this->f->a))->assertOk();
    $this->getJson('/api/coach/terms', bearer($this->f->a1))->assertStatus(403);
});
