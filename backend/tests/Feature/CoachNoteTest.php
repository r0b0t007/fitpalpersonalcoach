<?php

// A coach's replies to check-ins and comments on workouts (CHW-340): written by the coach on their
// own client only, read by that client from the coach they have now, told by a push, or by one
// email a day to a client with no push, and gone when the link between the two ends.

use App\Jobs\SendPush;
use App\Mail\AccountMail;
use App\Models\CoachNote;
use App\Models\PushSubscription;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.origin' => 'https://coach.example']);
    $this->f = Coaching::twoCoaches();
    Mail::fake();
    Bus::fake([SendPush::class]);
    RateLimiter::clear('note-mail:'.$this->f->a1->id);
});

function writeNote(object $coach, string $memberId, array $over = [])
{
    return test()->postJson('/api/coach/notes', $over + ['memberId' => $memberId, 'refType' => 'checkin', 'refKey' => '2026-11-01', 'body' => '  Bien joué cette semaine.  '], bearer($coach));
}

function noteSubscriber(object $user): void
{
    (new PushSubscription)->forceFill(['user_id' => $user->id, 'endpoint' => 'https://push.example/'.$user->id,
        'endpoint_hash' => PushSubscription::hashOf('https://push.example/'.$user->id), 'p256dh' => 'k', 'auth' => 'a', 'created' => 1])->save();
}

it('lets a coach reply to their own client, and the client read it, newest first', function () {
    writeNote($this->f->a, $this->f->a1->id)->assertOk()->assertJsonPath('note.body', 'Bien joué cette semaine.')->assertJsonCount(1, 'notes');
    writeNote($this->f->a, $this->f->a1->id, ['refType' => 'workout', 'refKey' => 'w123', 'body' => 'Belle séance'])->assertOk();
    $notes = $this->getJson('/api/notes', bearer($this->f->a1))->assertOk()->json('notes');
    expect(array_column($notes, 'body'))->toBe(['Belle séance', 'Bien joué cette semaine.'])
        ->and($notes[0])->toMatchArray(['refType' => 'workout', 'refKey' => 'w123', 'readAt' => null]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.note.create', 'uid' => $this->f->a->id, 'msg' => $this->f->a1->id]);
    // The coach sees them on the client's page.
    $this->getJson('/api/coach/member?id='.$this->f->a1->id, bearer($this->f->a))->assertOk()->assertJsonCount(2, 'notes');
});

it('marks every note read for the client, and only theirs', function () {
    writeNote($this->f->a, $this->f->a1->id);
    writeNote($this->f->a, $this->f->a2->id);
    $this->postJson('/api/notes/read', [], bearer($this->f->a1))->assertOk()->assertJsonPath('notes.0.readAt', fn ($v) => is_int($v));
    expect(CoachNote::acrossCoaches()->where('member_id', $this->f->a2->id)->value('read_at'))->toBeNull(); // across coaches: the test reads the other client's note
});

it('refuses a note on someone else\'s client, an empty or too long one, and one about nothing', function () {
    writeNote($this->f->b, $this->f->a1->id)->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    writeNote($this->f->a, $this->f->u1->id)->assertStatus(403);
    writeNote($this->f->a1, $this->f->a2->id)->assertStatus(403);   // a client is no coach
    writeNote($this->f->a, $this->f->a1->id, ['body' => '   '])->assertStatus(400)->assertExactJson(['error' => 'write a note first']);
    writeNote($this->f->a, $this->f->a1->id, ['body' => str_repeat('a', CoachNote::BODY_MAX + 1)])->assertStatus(400)->assertExactJson(['error' => 'note too long']);
    writeNote($this->f->a, $this->f->a1->id, ['refType' => 'photo'])->assertStatus(400)->assertExactJson(['error' => 'bad note target']);
    writeNote($this->f->a, $this->f->a1->id, ['refKey' => ''])->assertStatus(400);
    expect(CoachNote::acrossCoaches()->count())->toBe(0); // across coaches: nothing stored for anyone
});

it('tells a client with push by a push, and one without by at most one email a day', function () {
    noteSubscriber($this->f->a1);
    writeNote($this->f->a, $this->f->a1->id);
    Bus::assertDispatched(SendPush::class, fn (SendPush $p) => $p->userId === $this->f->a1->id && $p->kind === 'coach-note' && $p->args === ['Coach A']);
    Mail::assertNothingSent();

    $this->f->a2->forceFill(['email' => 'a2@example.com', 'email_verified_at' => now()])->save();
    writeNote($this->f->a, $this->f->a2->id);
    writeNote($this->f->a, $this->f->a2->id);
    Mail::assertSent(AccountMail::class, 1);
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'note' && $m->hasTo('a2@example.com')
        && str_contains($m->words['subject'], 'Coach A') && ! str_contains($m->render(), 'Bien joué'));
});

it('sends no email to an address the client never proved', function () {
    $this->f->a2->forceFill(['email' => 'a2@example.com', 'email_verified_at' => null])->save();
    writeNote($this->f->a, $this->f->a2->id)->assertOk();
    Mail::assertNothingSent();
});

it('forgets what was written when the client is released, and a new coach reads none of it', function () {
    writeNote($this->f->a, $this->f->a1->id);
    $this->postJson('/api/coach/member/release', ['id' => $this->f->a1->id], bearer($this->f->a))->assertOk();
    expect(CoachNote::acrossCoaches()->count())->toBe(0); // across coaches: nothing left for anyone
    $this->getJson('/api/notes', bearer($this->f->a1))->assertOk()->assertExactJson(['notes' => []]);
});
