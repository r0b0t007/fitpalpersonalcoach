<?php

// The operator's funnel (CHW-335): page views counted without a visitor in them, a client's first
// workout as the server saw it, and the two tables the Monday review reads off the panel.

use App\Filament\Funnel;
use App\Filament\Widgets\CoachFunnel;
use App\Filament\Widgets\FollowerFunnel;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\Licence;
use App\Models\User;
use App\Models\UserState;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Livewire\Livewire;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32)]);
    $this->f = Coaching::twoCoaches();
    // A Wednesday, so the week runs from Monday 2026-11-02.
    $this->travelTo(CarbonImmutable::parse('2026-11-04 12:00:00', 'UTC'));
});

function funnelPage(User $coach, string $handle, bool $open = true): CoachPage
{
    return Coaching::own(new CoachPage, $coach, ['handle' => $handle, 'bio' => '', 'whatsapp' => '', 'open' => $open, 'theme' => 'dark', 'created' => 1, 'updated' => 1]);
}

function funnelEvent(string $ev, ?string $uid, ?string $tgt, int $ts): void
{
    DB::table('audit_events')->insert(['ts' => $ts, 'ev' => $ev, 'ok' => true, 'uid' => $uid, 'tgt' => $tgt]);
}

/** A state saved as a sync saves it, through the model. */
function funnelState(User $user, array $workouts): UserState
{
    $row = UserState::query()->find($user->id) ?? (new UserState)->forceFill(['user_id' => $user->id]);
    $row->forceFill(['state' => json_encode(['workouts' => $workouts])])->save();

    return $row->refresh();
}

function funnelAccepted(User $coach, User $member, int $created): void
{
    Coaching::own(new JoinRequest, $coach, ['id' => JoinRequest::newId(), 'email' => $member->id.'@example.com', 'name' => $member->name, 'intake' => JoinRequest::BLANK,
        'status' => 'accepted', 'member_id' => $member->id, 'created' => $created, 'decided' => $created]);
}

it("counts a person's view of an open page, by the day, and nothing about them", function () {
    funnelPage($this->f->a, 'sara.fit');
    // The coach looking at their own page is no view; the join form reads the card without
    // counting it; a closed page shows nothing to count.
    $this->getJson('/api/public/coach?h=sara.fit&view=1', bearer($this->f->a))->assertOk();
    $this->getJson('/api/public/coach?h=sara.fit')->assertOk();
    funnelPage($this->f->b, 'closed.fit', false);
    $this->getJson('/api/public/coach?h=closed.fit&view=1')->assertNotFound();
    // A person is one view a half hour, however often they reload; another person is another.
    $this->getJson('/api/public/coach?h=sara.fit&view=1')->assertOk();
    $this->getJson('/api/public/coach?h=sara.fit&view=1')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])->getJson('/api/public/coach?h=sara.fit&view=1')->assertOk();
    $this->travel(31)->minutes();
    $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])->getJson('/api/public/coach?h=sara.fit&view=1')->assertOk();

    expect(DB::table('coach_page_views')->get()->map(fn ($r) => (array) $r)->all())
        ->toBe([['coach_id' => $this->f->a->id, 'day' => '2026-11-04', 'n' => 3]]);
    $this->assertDatabaseCount('audit_events', 0);
});

it('notes the first workout once, on the server clock, and the last one on every save', function () {
    expect(funnelState($this->f->a1, [])->only(['first_workout_at', 'last_workout']))->toBe(['first_workout_at' => null, 'last_workout' => null]);
    $first = now()->getTimestampMs();
    expect(funnelState($this->f->a1, [['d' => '2026-11-03']])->only(['first_workout_at', 'last_workout']))->toBe(['first_workout_at' => $first, 'last_workout' => '2026-11-03']);

    $this->travel(2)->days();
    expect(funnelState($this->f->a1, [['d' => '2026-11-03'], ['d' => '2026-11-06']])->only(['first_workout_at', 'last_workout']))->toBe(['first_workout_at' => $first, 'last_workout' => '2026-11-06']);
    // History deleted: still activated.
    expect(funnelState($this->f->a1, [])->only(['first_workout_at', 'last_workout']))->toBe(['first_workout_at' => $first, 'last_workout' => null]);
});

it('sets the first workout from a sync too', function () {
    $this->putJson('/api/data', ['state' => ['workouts' => [['d' => '2026-11-04']]]], bearer($this->f->a1))->assertOk();
    expect(UserState::query()->find($this->f->a1->id)->only(['first_workout_at', 'last_workout']))
        ->toBe(['first_workout_at' => now()->getTimestampMs(), 'last_workout' => '2026-11-04']);
});

it('reads each sign-up week of self-serve coaches through to paid', function () {
    // Coach A signed up 6 weeks ago: page open, a request, three clients training this week, paid.
    $this->f->a->forceFill(['self_serve' => true, 'created_at' => now()->subDays(40)])->save();
    funnelPage($this->f->a, 'sara.fit');
    funnelAccepted($this->f->a, $this->f->a1, 1);
    $a3 = tap((new User)->forceFill(['id' => 'tA3000000000000x', 'name' => 'Client A3', 'coach_id' => $this->f->a->id]))->save();
    foreach ([$this->f->a1, $this->f->a2, $a3] as $client) {
        funnelState($client, [['d' => '2026-11-02']]);
    }
    (new Licence)->forceFill(['id' => 'licA', 'user_id' => $this->f->a->id, 'status' => 'active', 'source' => 'creem', 'period_start' => now()->subDays(10)])->save();
    // Coach B signed up this week: a closed page, one client who has not trained, a request the
    // log remembers after the row went.
    $this->f->b->forceFill(['self_serve' => true, 'created_at' => now()->subDay()])->save();
    funnelPage($this->f->b, 'closed.fit', false);
    funnelEvent('join.request', null, $this->f->b->id, now()->getTimestampMs());
    // An admin-made coach and an admin are not anyone's sign-up.
    tap((new User)->forceFill(['id' => 'tCoachC000000000', 'name' => 'Coach C', 'coach' => true]))->save();

    $rows = Funnel::coaches(8);
    expect(array_keys($rows))->toHaveCount(8)->and(array_key_first($rows))->toBe('2026-11-02')
        ->and($rows['2026-11-02'])->toMatchArray(['signups' => 1, 'page' => 0, 'requested' => 1, 'client' => 1, 'activated' => 0, 'habitDue' => 0, 'paid' => 0])
        ->and($rows['2026-09-21'])->toMatchArray(['signups' => 1, 'page' => 1, 'requested' => 1, 'client' => 1, 'activated' => 1, 'habitDue' => 1, 'habit' => 1, 'paid' => 1]);
    expect(array_sum(array_column($rows, 'signups')))->toBe(2);

    // Trialing is not paying, though a trial carries a period; nor is a coach paying who has not
    // activated (B, this week), as paid is a step after activation.
    Licence::query()->whereKey('licA')->update(['status' => 'trialing', 'trial_ends_at' => now()->addDays(5)]);
    (new Licence)->forceFill(['id' => 'licB', 'user_id' => $this->f->b->id, 'status' => 'active', 'source' => 'creem', 'period_start' => now()->subDay()])->save();
    $rows = Funnel::coaches(8);
    expect($rows['2026-09-21']['paid'])->toBe(0)->and($rows['2026-11-02']['paid'])->toBe(0);

    // The last 7 days are today and the 6 before: a workout 7 days back is not in them, and A's
    // habit is gone — read today, not on day 30.
    $this->travelTo(CarbonImmutable::parse('2026-11-09 12:00:00', 'UTC'));
    expect(Funnel::coaches(8)['2026-09-21'])->toMatchArray(['habitDue' => 1, 'habit' => 0]);
    $this->travelTo(CarbonImmutable::parse('2026-11-08 12:00:00', 'UTC'));
    expect(Funnel::coaches(8)['2026-09-21'])->toMatchArray(['habitDue' => 1, 'habit' => 1]);
});

it("follows each coach's followers over the window, to the median wait for a first workout", function () {
    $now = now()->getTimestampMs();
    $h = 3_600_000;
    funnelPage($this->f->a, 'sara.fit');
    DB::table('coach_page_views')->insert([
        ['coach_id' => $this->f->a->id, 'day' => '2026-11-04', 'n' => 30],
        ['coach_id' => $this->f->a->id, 'day' => '2026-10-01', 'n' => 99],   // before the window
        ['coach_id' => $this->f->b->id, 'day' => '2026-11-01', 'n' => 4],
    ]);
    foreach ([['join.request', null, $this->f->a->id], ['join.request', null, $this->f->a->id], ['join.verify', null, $this->f->a->id],
        ['coach.request.accept', $this->f->a->id, $this->f->a1->id], ['coach.request.auto', $this->f->a2->id, $this->f->a->id]] as [$ev, $uid, $tgt]) {
        funnelEvent($ev, $uid, $tgt, $now - $h);
    }
    funnelEvent('join.request', null, $this->f->a->id, $now - 40 * 24 * $h);   // before the window
    // a1 asked, and trained 2 h later; a2, 6 h later; b1 had trained before they asked.
    funnelAccepted($this->f->a, $this->f->a1, $now - 10 * $h);
    funnelAccepted($this->f->a, $this->f->a2, $now - 10 * $h);
    funnelAccepted($this->f->b, $this->f->b1, $now - $h);
    $this->travelTo(CarbonImmutable::createFromTimestampMs($now - 8 * $h));
    funnelState($this->f->a1, [['d' => '2026-11-04']]);
    $this->travelTo(CarbonImmutable::createFromTimestampMs($now - 4 * $h));
    funnelState($this->f->a2, [['d' => '2026-11-04']]);
    $this->travelTo(CarbonImmutable::createFromTimestampMs($now - 5 * $h));
    funnelState($this->f->b1, [['d' => '2026-11-04']]);
    $this->travelTo(CarbonImmutable::createFromTimestampMs($now));

    $funnel = Funnel::followers(30);
    expect(array_keys($funnel['rows']))->toBe(['all', $this->f->a->id, $this->f->b->id])
        ->and($funnel['rows'][$this->f->a->id])->toBe(['coach' => 'Coach A · sara.fit', 'views' => 30, 'requests' => 2, 'verified' => 1, 'accepted' => 2, 'trained' => 2, 'median' => 4 * $h])
        ->and($funnel['rows'][$this->f->b->id])->toMatchArray(['coach' => 'Coach B', 'views' => 4, 'trained' => 0, 'median' => null])
        ->and($funnel['rows']['all'])->toMatchArray(['views' => 34, 'requests' => 2, 'accepted' => 2, 'trained' => 2, 'median' => 4 * $h])
        // The log reaches back 40 days, past the window: nothing missing.
        ->and($funnel['auditSince'])->toBeNull();
});

it('says when the audit log does not reach back across the window, and when it is off', function () {
    funnelEvent('join.request', null, $this->f->a->id, now()->subDays(3)->getTimestampMs());
    $funnel = Funnel::followers(30);
    expect($funnel['auditSince'])->toBe(now()->subDays(3)->getTimestampMs())->and($funnel['auditOff'])->toBeFalse()
        ->and(FollowerFunnel::note($funnel))->toContain('since 2026-11-01 only');
    // Past retention, an event the prune has yet to reach is not counted (Audit::kept).
    config(['fitpal.audit.days' => 2]);
    expect(Funnel::followers(30)['rows']['all']['requests'])->toBe(0);
    config(['fitpal.audit.enabled' => false]);
    expect(FollowerFunnel::note(Funnel::followers(30)))->toContain('The audit log is off');
});

it('counts the window by calendar day, today one of the 30', function () {
    DB::table('coach_page_views')->insert([
        ['coach_id' => $this->f->a->id, 'day' => '2026-10-06', 'n' => 1],   // the 30th day back
        ['coach_id' => $this->f->a->id, 'day' => '2026-10-05', 'n' => 50],  // the 31st
    ]);
    funnelEvent('join.request', null, $this->f->a->id, CarbonImmutable::parse('2026-10-06 00:00:01', 'UTC')->getTimestampMs());
    funnelEvent('join.request', null, $this->f->a->id, CarbonImmutable::parse('2026-10-05 23:59:59', 'UTC')->getTimestampMs());
    expect(Funnel::followers(30)['rows']['all'])->toMatchArray(['views' => 1, 'requests' => 1]);
});

it('draws both tables on the panel', function () {
    $this->f->a->forceFill(['self_serve' => true, 'created_at' => now()])->save();
    funnelPage($this->f->a, 'sara.fit');
    DB::table('coach_page_views')->insert(['coach_id' => $this->f->a->id, 'day' => '2026-11-04', 'n' => 12]);
    $this->actingAs($this->f->admin);
    Livewire::test(CoachFunnel::class)->assertSuccessful()->assertSee('Coach funnel, by sign-up week')->assertSee('2026-11-02');
    Livewire::test(FollowerFunnel::class)->assertSuccessful()->assertSee('All coaches')->assertSee('Coach A · sara.fit')->assertSee('12');
    expect(CoachFunnel::share(3, 4))->toBe('3 · 75%')->and(CoachFunnel::share(2, 0))->toBe('2')
        ->and(FollowerFunnel::duration(null))->toBe('—')->and(FollowerFunnel::duration(90_000))->toBe('2 min')
        ->and(FollowerFunnel::duration(30 * 3_600_000))->toBe('30 h')->and(FollowerFunnel::duration(5 * 86_400_000))->toBe('5 days');
});
