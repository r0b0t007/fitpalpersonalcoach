<?php

// The rest-timer push (CHW-261): POST /api/push/rest-timer {seconds}, /cancel, and the delayed
// RestTimerPush job that sends "Rest over" only while it is still the user's one timer
// (api/server.js scheduleRestTimer / cancelRestTimer).

use App\Jobs\RestTimerPush;
use App\Models\UserState;
use App\Push\Sender;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->spy = new class extends Sender
    {
        public array $sent = [];

        public function send(string $userId, array $payload): void
        {
            $this->sent[] = [$userId, $payload];
        }
    };
});

it('queues "rest over" for when the rest ends, clamped to 1 s - 1 h as Node', function () {
    $a1 = $this->f->a1;
    Bus::fake();
    foreach ([[90, 90], [2.5, 3], [-2.5, 1], [0, 1], ['abc', 1], ['45', 45], [99999, 3600], [null, 1], [['30'], 30]] as [$given, $sec]) {
        $this->freezeSecond();
        $this->postJson('/api/push/rest-timer', ['seconds' => $given], bearer($a1))->assertExactJson(['ok' => true]);
        Bus::assertDispatched(RestTimerPush::class, fn (RestTimerPush $j) => $j->userId === $a1->id
            && $j->token === Cache::get(RestTimerPush::key($a1->id))
            && $j->delay->getTimestamp() === now()->addSeconds($sec)->getTimestamp());
        Bus::fake();
    }
    $this->postJson('/api/push/rest-timer', ['seconds' => 60])->assertStatus(401);
    $this->postJson('/api/push/rest-timer/cancel')->assertStatus(401);
    $this->call('POST', '/api/push/rest-timer', [], [], [], $this->transformHeadersToServerVars(bearer($a1)) + ['CONTENT_TYPE' => 'application/json'], '{nope')
        ->assertStatus(400)->assertExactJson(['error' => 'bad json']);
});

it('sends only the current timer: a newer one or a cancel silences the queued job', function () {
    $a1 = $this->f->a1;
    (new UserState)->forceFill(['user_id' => $a1->id, 'state' => json_encode(['lang' => 'de'])])->save();
    $jobs = [];
    Bus::fake();
    $this->postJson('/api/push/rest-timer', ['seconds' => 60], bearer($a1))->assertOk();
    $this->postJson('/api/push/rest-timer', ['seconds' => 90], bearer($a1))->assertOk();   // extended
    Bus::assertDispatched(RestTimerPush::class, function (RestTimerPush $j) use (&$jobs) {
        $jobs[] = $j;

        return true;
    });
    [$first, $second] = $jobs;
    $first->handle($this->spy);
    expect($this->spy->sent)->toBe([]);
    $second->handle($this->spy);
    expect($this->spy->sent)->toBe([[$a1->id, ['title' => 'Pause vorbei 💪', 'body' => 'Zeit für deinen nächsten Satz.', 'tag' => 'rest-timer']]]);
    // Once only, should the same job run twice.
    $second->handle($this->spy);
    expect($this->spy->sent)->toHaveCount(1);

    // Cancelled before it was due: nothing.
    $this->postJson('/api/push/rest-timer', ['seconds' => 30], bearer($a1))->assertOk();
    $third = null;
    Bus::assertDispatched(RestTimerPush::class, function (RestTimerPush $j) use (&$third) {
        $third = $j;

        return true;
    });
    $this->postJson('/api/push/rest-timer/cancel', [], bearer($a1))->assertExactJson(['ok' => true]);
    $third->handle($this->spy);
    expect($this->spy->sent)->toHaveCount(1);
});

it('keeps each user\'s timer to themselves', function () {
    Bus::fake();
    $this->postJson('/api/push/rest-timer', ['seconds' => 60], bearer($this->f->a1))->assertOk();
    $job = null;
    Bus::assertDispatched(RestTimerPush::class, function (RestTimerPush $j) use (&$job) {
        $job = $j;

        return true;
    });
    $this->postJson('/api/push/rest-timer/cancel', [], bearer($this->f->a2))->assertOk();
    $job->handle($this->spy);
    expect($this->spy->sent)->toHaveCount(1)->and($this->spy->sent[0][1]['title'])->toBe('Rest over 💪');
});
