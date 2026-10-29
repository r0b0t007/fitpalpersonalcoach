<?php

// fitpal:seed-demo (CHW-307), the port of api/seed-demo.mjs: six demo clients with histories on
// one coach's roster, read back through the same routes the coach app reads; --remove takes out
// exactly what it added, and --list changes nothing.

use App\Console\Commands\SeedDemo;
use App\Models\Assignment;
use App\Models\User;
use App\Models\UserState;
use Illuminate\Support\Carbon;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use Tests\Support\Billing;

const DEMO_IDS = ['demo-karim', 'demo-lina', 'demo-nadia', 'demo-omar', 'demo-sara', 'demo-youssef'];

function account(string $id, array $more = []): User
{
    return tap((new User)->forceFill($more + ['id' => $id, 'name' => $id]))->save();
}

function demoState(string $id): stdClass
{
    return json_decode(UserState::query()->find($id)->state);
}

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-10-28T23:30:00Z'));
    $this->coach = account('tCoach0000000000', ['coach' => true, 'name' => 'Coach']);
});

it('seeds six clients onto the only coach, which the coach app reads back', function () {
    $this->artisan('fitpal:seed-demo')->assertSuccessful()
        ->expectsOutputToContain('Seeded 6 clients onto Coach (tCoach0000000000)');

    $members = collect($this->getJson('/api/coach/members', bearer($this->coach))->assertOk()->json('members'))->keyBy('id');
    expect($members->keys()->sort()->values()->all())->toBe(DEMO_IDS)
        ->and($members['demo-karim']['workouts'])->toBeGreaterThan(50)
        ->and($members['demo-karim']['lastDecision'])->toBe(['status' => 'accepted', 'at' => $members['demo-karim']['lastDecision']['at']])
        ->and($members['demo-lina']['pending'])->toHaveCount(1)
        ->and($members['demo-omar']['workouts'])->toBe(0)
        ->and($members['demo-omar']['routines'])->toBe(0);
    $this->getJson('/api/coach/member?id=demo-nadia', bearer($this->coach))->assertOk()
        ->assertJsonPath('user.name', 'Nadia El Amrani')->assertJsonPath('checkins.0.answers.energy', fn ($v) => $v >= 1 && $v <= 5);

    // Nobody can sign in as one.
    expect(User::query()->whereKey(DEMO_IDS)->where(fn ($q) => $q->whereNotNull('email')->orWhereNotNull('password'))->count())->toBe(0)
        ->and(WebAuthnCredential::query()->whereIn('authenticatable_id', DEMO_IDS)->count())->toBe(0);
});

it('dates nothing in the future, and writes the calendar of --tz', function () {
    $this->artisan('fitpal:seed-demo')->assertSuccessful();
    $now = now()->getTimestampMs();
    foreach (DEMO_IDS as $id) {
        $s = demoState($id);
        expect($s->_ts)->toBeLessThanOrEqual($now);
        foreach ($s->workouts as $w) {
            expect($w->end)->toBeLessThanOrEqual($now)->toBeGreaterThan($w->start);
        }
        foreach ([...$s->bodyweight, ...$s->checkins, ...$s->workouts] as $row) {
            expect($row->d)->toBeLessThanOrEqual('2026-10-28');
        }
        // S.week is an object even when empty, day -> array of routine ids.
        expect($s->week)->toBeInstanceOf(stdClass::class);
    }
    expect(end(demoState('demo-nadia')->checkins)->d)->toBe('2026-10-28');   // UTC, the app's default

    // 23:30 UTC is already the 29th in Tokyo: the check-in filed "today" is the coach's today.
    $this->artisan('fitpal:seed-demo', ['--remove' => true])->assertSuccessful();
    $this->artisan('fitpal:seed-demo', ['--tz' => 'Asia/Tokyo'])->assertSuccessful();
    expect(end(demoState('demo-nadia')->checkins)->d)->toBe('2026-10-29');
});

it('comes out the same on every run', function () {
    $this->artisan('fitpal:seed-demo')->assertSuccessful();
    $first = UserState::query()->whereKey(DEMO_IDS)->orderBy('user_id')->pluck('state')->all();
    $this->artisan('fitpal:seed-demo', ['--remove' => true])->assertSuccessful();
    $this->artisan('fitpal:seed-demo')->assertSuccessful();
    expect(UserState::query()->whereKey(DEMO_IDS)->orderBy('user_id')->pluck('state')->all())->toBe($first);
});

it('removes exactly what it added, and any offer sent to a demo client since', function () {
    // A real account whose minted id happens to start with the prefix, its state, and a client.
    account('demo-0123456789a', ['coach_id' => $this->coach->id]);
    UserState::query()->create(['user_id' => 'demo-0123456789a', 'state' => '{}', 'ts' => 1]);
    account('tClient000000000', ['coach_id' => $this->coach->id]);

    $this->artisan('fitpal:seed-demo', ['--coach' => $this->coach->id])->assertSuccessful();
    (new Assignment)->forceFill(['id' => 'sentLater0000000', 'coach_id' => $this->coach->id, 'coach_name' => 'Coach',
        'member_id' => 'demo-sara', 'bundle' => '{}', 'status' => 'pending', 'created' => '2026-10-28T00:00:00.000Z'])->save();

    $this->artisan('fitpal:seed-demo', ['--remove' => true])->assertSuccessful()
        ->expectsOutputToContain('6 demo client(s) removed, with 6 state(s) and 6 assignment(s)');
    expect(User::query()->orderBy('id')->pluck('id')->all())->toBe(['demo-0123456789a', 'tClient000000000', 'tCoach0000000000'])
        ->and(UserState::query()->pluck('user_id')->all())->toBe(['demo-0123456789a'])
        ->and(Assignment::acrossCoaches()->count())->toBe(0); // across coaches: the test counts every row

    $this->artisan('fitpal:seed-demo', ['--remove' => true])->assertSuccessful()->expectsOutputToContain('Nothing to remove.');
});

it('lists what is seeded and changes nothing', function () {
    $this->artisan('fitpal:seed-demo', ['--list' => true])->assertSuccessful()->expectsOutputToContain('Nothing seeded');
    $this->artisan('fitpal:seed-demo')->assertSuccessful();
    $before = UserState::query()->orderBy('user_id')->pluck('state')->all();
    $this->artisan('fitpal:seed-demo', ['--list' => true])->assertSuccessful()
        ->expectsOutputToContain('6 demo client(s):')
        ->expectsOutputToContain('coach=tCoach0000000000')
        ->expectsOutputToContain('5 assignment(s): ');
    expect(UserState::query()->orderBy('user_id')->pluck('state')->all())->toBe($before);
});

it('refuses a second seed, an unknown or ambiguous coach, and a bad --tz, writing nothing', function () {
    $this->artisan('fitpal:seed-demo', ['--tz' => 'Mars/Olympus'])->assertFailed()->expectsOutputToContain('--tz takes a timezone name');
    $this->artisan('fitpal:seed-demo', ['--coach' => 'nobody'])->assertFailed()->expectsOutputToContain('no coach with id nobody');
    account('tClient000000000', ['coach_id' => $this->coach->id]);
    $this->artisan('fitpal:seed-demo', ['--coach' => 'tClient000000000'])->assertFailed()->expectsOutputToContain('no coach with id');
    account('tOwner0000000000', ['admin' => true]);
    $this->artisan('fitpal:seed-demo')->assertFailed()->expectsOutputToContain('more than one coach')
        ->expectsOutputToContain('--coach tOwner0000000000');
    expect(User::query()->count())->toBe(3);

    $this->artisan('fitpal:seed-demo', ['--coach' => 'tOwner0000000000'])->assertSuccessful();
    $this->artisan('fitpal:seed-demo', ['--coach' => 'tOwner0000000000'])->assertFailed()->expectsOutputToContain('already seeded: 6 demo client(s)');
    expect(User::query()->count())->toBe(9);
});

it('refuses to seed or remove on production without --force, but lists', function () {
    app()->detectEnvironment(fn () => 'production');
    $this->artisan('fitpal:seed-demo')->assertFailed()->expectsOutputToContain('Say so with --force');
    $this->artisan('fitpal:seed-demo', ['--remove' => true])->assertFailed();
    $this->artisan('fitpal:seed-demo', ['--list' => true])->assertSuccessful();
    expect(User::query()->count())->toBe(1);

    $this->artisan('fitpal:seed-demo', ['--force' => true])->assertSuccessful();
    $this->artisan('fitpal:seed-demo', ['--remove' => true, '--force' => true])->assertSuccessful();
    expect(User::query()->count())->toBe(1);
});

it('counts back in calendar days across a DST change, and dates no session before its account', function () {
    // 23:30 in Paris, three days after the clocks went back (2026-10-25): 24-hour blocks put two
    // weigh-ins on the 25th and none on the 24th.
    $this->travelTo(Carbon::parse('2026-10-28T22:30:00Z'));
    $this->artisan('fitpal:seed-demo', ['--tz' => 'Europe/Paris'])->assertSuccessful();
    $weighIns = array_column(demoState('demo-karim')->bodyweight, 'd');
    expect($weighIns)->toBe(array_values(array_unique($weighIns)))
        ->and($weighIns)->toContain('2026-10-27')->toContain('2026-10-20')->not->toContain('2026-10-21');
    $checkins = array_column(demoState('demo-nadia')->checkins, 'd');
    foreach (array_slice($checkins, 1) as $i => $d) {
        expect((new DateTime($checkins[$i]))->diff(new DateTime($d))->days)->toBe(7);
    }
    foreach (DEMO_IDS as $id) {
        $created = User::query()->find($id)->created_at->getTimestampMs();
        foreach (demoState($id)->workouts as $w) {
            expect($w->start)->toBeGreaterThanOrEqual($created);
        }
    }
});

it('logs pull-ups as the Node seeder did: 20 kg, a kilo a session', function () {
    $this->artisan('fitpal:seed-demo')->assertSuccessful();
    $pullups = collect(demoState('demo-karim')->workouts)->flatMap(fn ($w) => $w->entries)->where('id', '0652')->values();
    expect($pullups->first()->sets[0]->w)->toBe(20)
        ->and($pullups->last()->sets[0]->w)->toBe(20 + $pullups->count() - 1);
});

it('refuses to seed past a paying coach\'s seats', function () {
    Billing::on();
    Billing::licence($this->coach, ['plan' => 'solo', 'status' => 'active']);   // 10 seats
    foreach (range(1, 5) as $i) {
        account("tClient{$i}00000000", ['coach_id' => $this->coach->id]);
    }
    $this->artisan('fitpal:seed-demo')->assertFailed()->expectsOutputToContain('has 5 of 10 client seat(s) taken');
    expect(SeedDemo::demoUsers()->count())->toBe(0);

    User::query()->whereKey('tClient500000000')->update(['disabled' => true]);   // a disabled client frees a seat
    $this->artisan('fitpal:seed-demo')->assertSuccessful();
});

it('takes the timezone names Carbon takes, keeps Demo- accounts, and runs one action at a time', function () {
    $this->artisan('fitpal:seed-demo', ['--tz' => 'Etc/UTC'])->assertSuccessful();
    account('Demo-mine', ['coach_id' => $this->coach->id]);
    $this->artisan('fitpal:seed-demo', ['--remove' => true, '--list' => true])->assertFailed()->expectsOutputToContain('one of:');
    $this->artisan('fitpal:seed-demo', ['--remove' => true, '--tz' => 'UTC'])->assertFailed();
    expect(SeedDemo::demoUsers()->count())->toBe(6);
    $this->artisan('fitpal:seed-demo', ['--remove' => true])->assertSuccessful()->expectsOutputToContain('6 demo client(s) removed');
    expect(User::query()->whereKey('Demo-mine')->exists())->toBeTrue();
});
