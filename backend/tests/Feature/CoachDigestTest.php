<?php

// Telling the coach (CHW-339): a push for each check-in a client files, and one morning digest a
// day, by email and push, of what needs them — nothing on a quiet day.

use App\Console\Commands\CoachDigest;
use App\Jobs\SendPush;
use App\Mail\AccountMail;
use App\Mail\MailCopy;
use App\Models\JoinRequest;
use App\Models\PushSubscription;
use App\Models\User;
use App\Models\UserState;
use App\Push\Messages;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.origin' => 'https://coach.example']);
    $this->f = Coaching::twoCoaches();
    Mail::fake();
    Bus::fake([SendPush::class]);
});

function digestSubscriber(object $user): void
{
    (new PushSubscription)->forceFill(['user_id' => $user->id, 'endpoint' => 'https://push.example/'.$user->id,
        'endpoint_hash' => PushSubscription::hashOf('https://push.example/'.$user->id), 'p256dh' => 'k', 'auth' => 'a', 'created' => 1])->save();
}

/** What SendPush was dispatched with, as [user, kind, args]. */
function digestPushes(): array
{
    $out = [];
    Bus::assertDispatched(SendPush::class, function (SendPush $j) use (&$out) {
        $out[] = [$j->userId, $j->kind, $j->args];

        return true;
    });

    return $out;
}

const DIGEST_PLAN = [
    'routines' => [['id' => 'r1', 'name' => 'Full body', 'ex' => [['id' => '0001']]]],
    'week' => ['1' => ['r1'], '3' => ['r1'], '5' => ['r1']],   // Monday, Wednesday, Friday
];

// ---------------------------------------------------------------- a push for each check-in

it('tells the coach when their client files a check-in, once', function () {
    $this->travelTo('2026-11-05T10:00:00Z');
    $state = DIGEST_PLAN + ['checkins' => [['d' => '2026-11-05', 'answers' => ['energy' => 4]]]];
    $this->putJson('/api/data', ['state' => $state], bearer($this->f->a1))->assertOk();
    expect(digestPushes())->toBe([[$this->f->a->id, 'checkin-in', ['Client A1']]])
        ->and(UserState::query()->find($this->f->a1->id)->last_checkin)->toBe('2026-11-05');
    // The same state again (another device), and an edit of the same check-in: nothing new.
    $this->putJson('/api/data', ['state' => $state], bearer($this->f->a1))->assertOk();
    $state['checkins'][0]['note'] = 'Genou mieux';
    $this->putJson('/api/data', ['state' => $state], bearer($this->f->a1))->assertOk();
    expect(digestPushes())->toHaveCount(1);
});

it('does not tell anyone of an old check-in, one withheld from the coach, or a client with none', function () {
    $this->travelTo('2026-11-05T10:00:00Z');
    // Restored from a backup: the newest is ten days old.
    $this->putJson('/api/data', ['state' => ['checkins' => [['d' => '2026-10-26']]]], bearer($this->f->a1))->assertOk();
    // Not agreed to share their health data: their coach sees no check-ins, so hears of none.
    User::query()->whereKey($this->f->a2->id)->update(['health_consent_at' => null]);
    $this->putJson('/api/data', ['state' => ['checkins' => [['d' => '2026-11-05']]]], bearer($this->f->a2))->assertOk();
    // Nobody's client.
    $this->putJson('/api/data', ['state' => ['checkins' => [['d' => '2026-11-05']]]], bearer($this->f->u1))->assertOk();
    Bus::assertNotDispatched(SendPush::class);
});

it('keeps the newest check-in date beside the state, whoever saves it', function () {
    $row = UserState::query()->create(['user_id' => $this->f->a1->id, 'state' => json_encode(['checkins' => [['d' => '2026-11-01'], ['d' => '2026-11-03'], ['d' => 'nope']]])]);
    expect($row->last_checkin)->toBe('2026-11-03');
    $row->forceFill(['state' => json_encode(['checkins' => [['d' => 'nope']]])])->save();
    expect($row->refresh()->last_checkin)->toBeNull();
});

// ---------------------------------------------------------------- the morning digest

/**
 * The UTC instant of a wall-clock time in the default zone, from PHP's own zone data: Morocco's
 * offset is a decree, not a rule, and the zone files on different machines have disagreed on it.
 */
function casablanca(string $local): string
{
    return (new DateTimeImmutable($local, new DateTimeZone(CoachDigest::ZONE)))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

/** Coach A's morning: one request waiting, a1 on a Mon/Wed/Fri plan who trained Monday only and never checked in. */
function digestMorning(object $f): void
{
    $f->a->forceFill(['email' => 'coach-a@example.com', 'email_verified_at' => now()])->save();
    digestSubscriber($f->a);
    $f->a1->forceFill(['created_at' => '2026-10-01 09:00:00'])->save();
    UserState::query()->updateOrCreate(['user_id' => $f->a1->id], ['state' => json_encode(DIGEST_PLAN + ['workouts' => [['id' => 'w1', 'd' => '2026-11-02']]])]);
    Coaching::own(new JoinRequest, $f->a, ['id' => 'jr1', 'email' => 'x@example.com', 'name' => 'Nadia', 'lang' => 'fr', 'intake' => '{}', 'status' => 'pending', 'created' => 1]);
    // B has a client with nothing to report on and an address to send it to.
    $f->b->forceFill(['email' => 'coach-b@example.com', 'email_verified_at' => now()])->save();
}

it('sends the coach one digest at 07:00 on their own clock, and nothing before', function () {
    digestMorning($this->f);
    // 2026-11-05 is a Thursday.
    $this->travelTo(casablanca('2026-11-05 06:59'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertNothingSent();
    $this->travelTo(casablanca('2026-11-05 07:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    // Missed: Friday and Wednesday (Monday was trained, Thursday is today). Overdue: none filed.
    $counts = ['requests' => 1, 'checkins' => 1, 'missed' => 2];
    expect(digestPushes())->toBe([[$this->f->a->id, 'coach-digest', [$counts]]]);
    Mail::assertSent(AccountMail::class, 1);
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'digest' && $m->hasTo('coach-a@example.com')
        && $m->words['lines'] === ['Requests waiting: 1', 'Check-ins overdue: 1', 'Sessions missed in the last 7 days: 2']
        && str_contains($m->render(), 'https://coach.example/#/today'));
    expect(User::query()->find($this->f->a->id)->last_digest)->toBe('2026-11-05');
    // The rest of the morning sends nothing more; the next morning sends again.
    $this->travelTo(casablanca('2026-11-05 10:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertSent(AccountMail::class, 1);
    $this->travelTo(casablanca('2026-11-06 07:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertSent(AccountMail::class, 2);
});

it('sends nothing on a quiet morning, and leaves out what is not the coach\'s to see', function () {
    digestMorning($this->f);
    $this->travelTo(casablanca('2026-11-05 07:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    // Coach B's only client has no program: nothing to report, nothing sent, the day still handled.
    Mail::assertNotSent(AccountMail::class, fn (AccountMail $m) => $m->hasTo('coach-b@example.com'));
    expect(User::query()->find($this->f->b->id)->last_digest)->toBe('2026-11-05');
    // A client who withdrew consent: their check-in is not counted, their missed sessions still are.
    User::query()->whereKey($this->f->a1->id)->update(['health_consent_at' => null]);
    JoinRequest::acrossCoaches()->whereKey('jr1')->delete(); // across coaches: the test's own row
    $this->travelTo(casablanca('2026-11-06 07:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->hasTo('coach-a@example.com') && $m->words['lines'] === ['Sessions missed in the last 7 days: 2']);
});

it('follows the zone the coach\'s app recorded', function () {
    digestMorning($this->f);
    UserState::query()->updateOrCreate(['user_id' => $this->f->a->id], ['state' => json_encode(['reminder' => ['on' => false, 'time' => '08:00', 'tz' => 'America/New_York']])]);
    // 06:00 UTC is 01:00 in New York (EST from 1 November); 12:00 UTC is 07:00 there.
    $this->travelTo('2026-11-05T06:00:00Z');
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertNotSent(AccountMail::class, fn (AccountMail $m) => $m->hasTo('coach-a@example.com'));
    $this->travelTo('2026-11-05T12:00:00Z');
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->hasTo('coach-a@example.com'));
    expect(CoachDigest::morningOf('{"tz":"Not/AZone"}', new DateTimeImmutable(casablanca('2026-11-05 07:00'))))->toBe('2026-11-05')
        ->and(CoachDigest::morningOf(null, new DateTimeImmutable(casablanca('2026-11-05 11:59'))))->toBe('2026-11-05')
        ->and(CoachDigest::morningOf(null, new DateTimeImmutable(casablanca('2026-11-05 12:00'))))->toBeNull();
});

it('mails only an address the coach proved, and a disabled coach nothing', function () {
    digestMorning($this->f);
    $this->f->a->forceFill(['email_verified_at' => null])->save();
    $this->travelTo(casablanca('2026-11-05 07:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertNothingSent();
    expect(digestPushes())->toHaveCount(1);   // the push still goes
    $this->f->a->forceFill(['disabled' => true, 'email_verified_at' => now()])->save();
    $this->travelTo(casablanca('2026-11-06 07:00'));
    $this->artisan('fitpal:coach-digest')->assertSuccessful();
    Mail::assertNothingSent();
});

it('runs hourly in the background', function () {
    $e = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'fitpal:coach-digest'));
    expect($e->expression)->toBe('0 * * * *')->and($e->runInBackground)->toBeTrue()->and($e->withoutOverlapping)->toBeTrue();
});

// ---------------------------------------------------------------- the words

it('words the pushes in the coach\'s language, one line per count that is not zero', function () {
    expect(Messages::checkinIn('xx', 'Sara', 'App'))->toBe(['title' => 'App', 'body' => 'Sara filed a check-in', 'tag' => 'checkin-in'])
        ->and(Messages::digest('fr', ['requests' => 2, 'checkins' => 0, 'missed' => 3]))
        ->toBe(['title' => 'Vos clients aujourd’hui', 'body' => "Demandes en attente\u{00A0}: 2 · Séances manquées ces 7 derniers jours\u{00A0}: 3", 'tag' => 'coach-digest']);
    foreach (array_keys(Messages::COPY) as $lang) {
        expect(array_keys(Messages::COPY[$lang]))->toBe(array_keys(Messages::COPY['en']), $lang);
    }
});

it('has the digest mail in every language, French spaced before its colons', function () {
    $counts = ['requests' => 1, 'checkins' => 1, 'missed' => 1];
    foreach (MailCopy::LANGS as $lang) {
        $w = MailCopy::words($lang, 'digest', ['name' => 'Yasmine', 'counts' => $counts]);
        expect($w)->toHaveKeys(['subject', 'heading', 'body', 'button', 'footer'])->and($w['lines'])->toHaveCount(3);
        if ($lang === 'fr') {
            foreach ([...array_values(array_filter($w, 'is_string')), ...$w['lines']] as $text) {
                expect($text)->not->toMatch('/ [?!:;]/u', $text);
            }
        }
    }
});
