<?php

// Health data a coached client logs (CHW-360, DPIA M6/M9): check-ins, body weight, measurements,
// meals and progress photos reach their coach only with the client's explicit consent (GDPR
// Art. 9(2)(a)), given once and withdrawable; withdrawing deletes them. The consent is to one
// coach: a link that ends takes it with it.

use App\Models\ProgressPhoto;
use App\Models\User;
use App\Models\UserState;
use Illuminate\Filesystem\Filesystem;
use Tests\Support\Coaching;
use Tests\Support\MediaFixtures;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    // The fixture's clients have consented; these tests start from a client who has not.
    $this->f->a1->forceFill(['health_consent_at' => null])->save();
    $this->dataDir = sys_get_temp_dir().'/fitpal-consent-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir, 'fitpal.media_max_photo_mb' => 1]);
    UserState::query()->create(['user_id' => $this->f->a1->id, 'ts' => 1, 'state' => json_encode([
        'workouts' => [['d' => '2026-10-30', 'entries' => []]],
        'bodyweight' => [['d' => '2026-10-30', 'w' => 70]],
        'measurements' => [['d' => '2026-10-30', 'site' => 'waist', 'v' => 80]],
        'checkins' => [['d' => '2026-10-30', 'answers' => ['sleep' => 2], 'note' => 'knee hurts']],
        'meals' => [['id' => 'm1', 'd' => '2026-10-30']], 'mealDays' => ['2026-10-30' => true],
    ])]);
});

afterEach(fn () => (new Filesystem)->deleteDirectory($this->dataDir));

it('asks a coached client for consent, and nobody else', function () {
    $this->getJson('/api/me/health-consent', bearer($this->f->a1))->assertOk()->assertExactJson(['required' => true, 'consentAt' => null]);
    $this->getJson('/api/me/health-consent', bearer($this->f->u1))->assertOk()->assertExactJson(['required' => false, 'consentAt' => null]);
});

it('shows the coach none of it without consent, and all of it with', function () {
    $hidden = $this->getJson('/api/coach/member?id='.$this->f->a1->id, bearer($this->f->a))->assertOk();
    expect($hidden->json('checkins'))->toBe([])->and($hidden->json('bodyweight'))->toBe([])
        ->and($hidden->json('measurements'))->toBe([])->and($hidden->json('meals'))->toBe([])
        ->and($hidden->json('workouts'))->toHaveCount(1);   // training itself is not health data here
    $this->postJson('/api/me/health-consent', ['agree' => true], bearer($this->f->a1))->assertOk()
        ->assertJsonPath('required', true)->assertJsonPath('consentAt', fn ($v) => is_int($v));
    $this->assertDatabaseHas('audit_events', ['ev' => 'me.health.consent']);
    $shown = $this->getJson('/api/coach/member?id='.$this->f->a1->id, bearer($this->f->a))->assertOk();
    expect($shown->json('checkins.0.note'))->toBe('knee hurts')->and($shown->json('bodyweight'))->toHaveCount(1);
});

it('takes consent only as a plain yes', function (mixed $agree) {
    $this->postJson('/api/me/health-consent', $agree === 'missing' ? [] : ['agree' => $agree], bearer($this->f->a1))
        ->assertStatus(400)->assertExactJson(['error' => 'please agree to share this with your coach']);
    expect($this->f->a1->refresh()->health_consent_at)->toBeNull();
})->with(['missing', 'true', 1, false]);

it('keeps progress photos out until the client consents, both ways', function () {
    MediaFixtures::post($this->f->a1, '/api/media/photo?d=2026-10-30&pose=front', MediaFixtures::jpeg())
        ->assertStatus(403)->assertExactJson(['error' => 'agree to share your health data with your coach first']);
    $this->postJson('/api/me/health-consent', ['agree' => true], bearer($this->f->a1))->assertOk();
    $id = MediaFixtures::post($this->f->a1, '/api/media/photo?d=2026-10-30&pose=front', MediaFixtures::jpeg())->assertOk()->json('photo.id');
    $this->get('/api/media/photo?u='.$this->f->a1->id.'&id='.$id, bearer($this->f->a))->assertOk();
    // Consent cleared another way (a link that ended, below): the coach is refused again.
    User::query()->whereKey($this->f->a1->id)->update(['health_consent_at' => null]);
    $this->get('/api/media/photo?u='.$this->f->a1->id.'&id='.$id, bearer($this->f->a))->assertStatus(403);
    $this->get('/api/media/photo?id='.$id, bearer($this->f->a1))->assertOk();   // still the client's own
});

it('deletes the health data and the photos when consent is withdrawn', function () {
    $this->postJson('/api/me/health-consent', ['agree' => true], bearer($this->f->a1))->assertOk();
    MediaFixtures::post($this->f->a1, '/api/media/photo?d=2026-10-30&pose=front', MediaFixtures::jpeg())->assertOk();
    $this->postJson('/api/me/health-consent/withdraw', [], bearer($this->f->a1))->assertOk()
        ->assertExactJson(['required' => true, 'consentAt' => null]);
    $state = json_decode(UserState::query()->whereKey($this->f->a1->id)->value('state'), true);
    expect($state['checkins'])->toBe([])->and($state['bodyweight'])->toBe([])->and($state['measurements'])->toBe([])
        ->and($state['meals'])->toBe([])->and($state['mealDays'])->toBe([])
        ->and($state['workouts'])->toHaveCount(1)
        ->and(ProgressPhoto::query()->where('user_id', $this->f->a1->id)->count())->toBe(0)
        ->and(glob($this->dataDir.'/media/photo/'.$this->f->a1->id.'/*') ?: [])->toBe([]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'me.health.withdraw']);
});

it('ends the consent with the link to the coach it was given to', function () {
    $this->postJson('/api/me/health-consent', ['agree' => true], bearer($this->f->a1))->assertOk();
    $this->postJson('/api/coach/member/release', ['id' => $this->f->a1->id], bearer($this->f->a))->assertOk();
    expect($this->f->a1->refresh()->health_consent_at)->toBeNull();
});

it('lets a client with no coach log for themselves', function () {
    MediaFixtures::post($this->f->u1, '/api/media/photo?d=2026-10-30&pose=front', MediaFixtures::jpeg())->assertOk();
    expect(User::query()->find($this->f->u1->id)->health_consent_at)->toBeNull();
});
