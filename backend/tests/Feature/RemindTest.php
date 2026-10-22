<?php

// fitpal:remind and fitpal:prune (CHW-263): the reminders at the member's own time and zone, the
// previous-minute tolerance for a late cron run, never twice; and the hourly housekeeping.

use App\Jobs\SendPush;
use App\Models\MediaUpload;
use App\Models\Presence;
use App\Models\PushSubscription;
use App\Models\User;
use App\Models\UserState;
use App\Push\Reminders;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Queue;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    Queue::fake();
});

/** A member who allowed push, with this state. */
function remindable(User $u, array $state): void
{
    (new PushSubscription)->forceFill(['user_id' => $u->id, 'endpoint' => "https://push.example.com/{$u->id}", 'endpoint_hash' => PushSubscription::hashOf("https://push.example.com/{$u->id}"),
        'p256dh' => 'k', 'auth' => 'a', 'created' => 'x'])->save();
    UserState::query()->updateOrCreate(['user_id' => $u->id], ['state' => json_encode($state)]);
}

const PLAN = [
    'routines' => [['id' => 'r1', 'name' => 'Push', 'emoji' => '💪'], ['id' => 'r2', 'name' => 'Pull']],
    'week' => ['1' => ['gone', 'r2'], '3' => 'r1'],   // Monday: a list, the first that exists; Wednesday: one id
];

function pushed(): array
{
    $out = [];
    Queue::assertPushed(SendPush::class, function (SendPush $j) use (&$out) {
        $out[] = [$j->userId, $j->kind, $j->kind === 'day-reminder' ? $j->args[0]->name : null];

        return true;
    });

    return $out;
}

it('reminds at the member\'s own time in their own zone, and on a late cron run the minute after', function () {
    $a1 = $this->f->a1;
    // 2026-10-19 is a Monday. 08:00 in Lisbon (UTC+1 in October) is 07:00 UTC.
    remindable($a1, PLAN + ['reminder' => ['on' => true, 'time' => '08:00', 'tz' => 'Europe/Lisbon']]);
    $this->travelTo('2026-10-19T06:59:30Z');
    $this->artisan('fitpal:remind')->assertSuccessful();
    Queue::assertNothingPushed();
    // Cron started 40 s late into 07:01 UTC: 08:00 was the minute before — still due.
    $this->travelTo('2026-10-19T07:01:40Z');
    $this->artisan('fitpal:remind');
    expect(pushed())->toBe([[$a1->id, 'day-reminder', 'Pull']])
        ->and($a1->fresh()->last_reminder)->toBe('2026-10-19');
    // And never twice: the 07:00 run and the 07:01 run both see it.
    Queue::fake();
    $this->travelTo('2026-10-19T07:00:05Z');
    $this->artisan('fitpal:remind');
    Queue::assertNothingPushed();
});

it('sends the check-in nudge on the check-in day, once a period, even on a rest day', function () {
    $a1 = $this->f->a1;
    // Sunday 2026-10-25, the default check-in day; nothing planned on Sundays.
    remindable($a1, PLAN + ['reminder' => ['on' => true, 'time' => '19:30', 'tz' => 'UTC'], 'lang' => 'fr']);
    $this->travelTo('2026-10-25T19:30:10Z');
    $this->artisan('fitpal:remind');
    expect(pushed())->toBe([[$a1->id, 'checkin-reminder', null]])
        ->and($a1->fresh()->last_checkin_reminder)->toBe('2026-10-25');
    Queue::fake();
    $this->artisan('fitpal:remind');
    Queue::assertNothingPushed();
    // A check-in already in this period: no nudge (a member on Wednesday check-ins, here).
    $a2 = $this->f->a2;
    remindable($a2, ['reminder' => ['on' => true, 'time' => '19:30', 'tz' => 'UTC'], 'checkinDay' => 3.0, 'checkins' => [['d' => '2026-10-21']]]);
    $this->travelTo('2026-10-28T19:30:00Z');
    $this->artisan('fitpal:remind');
    expect(collect(pushed())->where(0, $a2->id)->pluck(1)->all())->toBe(['checkin-reminder']);
    expect(Reminders::checkinReminderDue((object) ['checkinDay' => 3, 'checkins' => [(object) ['d' => '2026-10-28']]], '2026-10-28'))->toBeFalse()
        ->and(Reminders::checkinPeriodStart((object) ['checkinDay' => 3], '2026-10-27'))->toBe('2026-10-21')
        ->and(Reminders::checkinDayOf((object) ['checkinDay' => 7]))->toBe(0);
});

it('holds back for a rest day, a workout already logged, reminders off, no push, a bad zone or a disabled account', function () {
    $f = $this->f;
    $this->travelTo('2026-10-21T12:00:00Z');   // Wednesday: r1 planned
    remindable($f->a1, PLAN + ['reminder' => ['on' => true, 'time' => '12:00', 'tz' => 'UTC'], 'dayPlan' => ['2026-10-21' => 'rest']]);
    remindable($f->a2, PLAN + ['reminder' => ['on' => true, 'time' => '12:00'], 'workouts' => [['d' => '2026-10-21']]]);
    remindable($f->b1, PLAN + ['reminder' => ['on' => false, 'time' => '12:00']]);
    remindable($f->d1, PLAN + ['reminder' => ['on' => true, 'time' => '12:00']]);   // disabled
    remindable($f->b, PLAN + ['reminder' => ['on' => true, 'time' => '12:00', 'tz' => 'Mars/Olympus']]);
    UserState::query()->create(['user_id' => $f->a->id, 'state' => json_encode(PLAN + ['reminder' => ['on' => true, 'time' => '12:00']])]);   // no browser
    $this->artisan('fitpal:remind');
    Queue::assertNothingPushed();
    // A day's own plan names a routine: that one, whatever the weekday says.
    UserState::query()->whereKey($f->a1->id)->update(['state' => json_encode(PLAN + ['reminder' => ['on' => true, 'time' => '12:00'], 'dayPlan' => ['2026-10-21' => 'r2']])]);
    $this->artisan('fitpal:remind');
    expect(pushed())->toBe([[$f->a1->id, 'day-reminder', 'Pull']]);
});

it('keeps the zone\'s own date across midnight', function () {
    $a1 = $this->f->a1;
    // 23:59 on Tuesday in Los Angeles is 06:59 on Wednesday UTC; the cron run lands at 07:00:30.
    remindable($a1, ['reminder' => ['on' => true, 'time' => '23:59', 'tz' => 'America/Los_Angeles'], 'week' => ['2' => 'r1']] + PLAN);
    $this->travelTo('2026-10-21T07:00:30Z');
    $this->artisan('fitpal:remind');
    expect(pushed())->toBe([[$a1->id, 'day-reminder', 'Push']])
        ->and($a1->fresh()->last_reminder)->toBe('2026-10-20');
});

it('prunes what has expired, and only that', function () {
    $f = $this->f;
    $dir = sys_get_temp_dir().'/fitpal-prune-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $dir]);
    @mkdir("$dir/media/ex", 0777, true);
    @mkdir("$dir/media/photo/someone", 0777, true);
    $this->travelTo('2026-10-22T12:00:00Z');
    $now = now()->getTimestampMs();
    Presence::query()->insert([['user_id' => $f->a1->id, 'payload' => '{}', 'updated_at' => $now - Presence::TTL_MS - 1], ['user_id' => $f->a2->id, 'payload' => '{}', 'updated_at' => $now]]);
    $upload = fn (string $id, int $touched) => tap((new MediaUpload)->forceFill(['id' => $id, 'coach_id' => $f->a->id, 'ex_id' => '0001', 'size' => 10, 'received' => 0, 'created' => 'x', 'touched' => $touched]))->save();
    $upload('stale', $now - MediaUpload::IDLE_MS - 1);
    $upload('fresh', $now - 1000);
    $old = $now / 1000 - MediaUpload::IDLE_MS / 1000 - 60;
    foreach (['ex/.up-stale', 'ex/.up-fresh', 'ex/.up-0123abcd', 'photo/someone/.up-89ab', 'ex/0001-keep.mp4'] as $name) {
        file_put_contents("$dir/media/$name", 'x');
        touch("$dir/media/$name", (int) $old);
    }
    file_put_contents("$dir/media/ex/.up-justnow", 'x');   // a request still writing it
    $this->artisan('fitpal:prune')->assertSuccessful();
    expect(Presence::query()->pluck('user_id')->all())->toBe([$f->a2->id])
        ->and(MediaUpload::acrossCoaches()->pluck('id')->all())->toBe(['fresh']) // across coaches: the test reads every row
        ->and(array_values(array_diff(scandir("$dir/media/ex"), ['.', '..'])))->toEqualCanonicalizing(['.up-fresh', '.up-justnow', '0001-keep.mp4'])
        ->and(glob("$dir/media/photo/someone/.up-*"))->toBe([]);
    (new Filesystem)->deleteDirectory($dir);
});
