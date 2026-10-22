<?php

// Plans and Entitlement (CHW-266, spec §2 and §6): what is sold, when billing is on, and what a
// coach may do under each licence status — in the spec's rule order.

use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Models\Licence;
use App\Models\User;
use Tests\Support\Coaching;

const PRODUCTS = 'solo:month=prod_sm,solo:year=prod_sy,pro:month=prod_pm,pro:year=prod_py,studio:month=prod_tm,studio:year=prod_ty';

function billingOn(string $products = PRODUCTS): void
{
    config(['fitpal.creem.api_key' => 'creem_test_key', 'fitpal.creem.webhook_secret' => 'whsec_test', 'fitpal.creem.products' => $products]);
}

/** A licence for $coach, put in force. */
function licence(User $coach, array $fields): Licence
{
    $l = tap((new Licence)->forceFill(['id' => Licence::newId(), 'user_id' => $coach->id, 'source' => 'creem'] + $fields))->save();
    $coach->forceFill(['licence_id' => $l->id])->save();

    return $l;
}

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    config(['fitpal.creem.api_key' => '', 'fitpal.creem.webhook_secret' => '', 'fitpal.creem.products' => '']);
});

it('reads CREEM_PRODUCTS both ways, and is on only with key, secret and a product', function () {
    expect(Plans::billingOn())->toBeFalse()->and(Plans::offered())->toBe([]);
    billingOn('pro:month=prod_pm, solo:year=prod_sy');
    expect(Plans::billingOn())->toBeTrue()
        ->and(Plans::product('pro', 'month'))->toBe('prod_pm')
        ->and(Plans::product('pro', 'year'))->toBeNull()
        ->and(Plans::fromProduct('prod_sy'))->toBe(['plan' => 'solo', 'period' => 'year'])
        ->and(Plans::fromProduct('prod_other'))->toBeNull()
        ->and(Plans::offered())->toBe([
            ['plan' => 'solo', 'cap' => 10, 'periods' => ['year']],
            ['plan' => 'pro', 'cap' => 30, 'periods' => ['month']],
        ]);
    config(['fitpal.creem.webhook_secret' => '']);
    expect(Plans::billingOn())->toBeFalse()
        ->and(Plans::problems())->toBe(['billing is off: CREEM_WEBHOOK_SECRET is not set, while CREEM_API_KEY and CREEM_PRODUCTS are. Set all three, or none.']);
});

it('ignores and reports an entry it cannot use', function () {
    billingOn('pro:month=prod_a,gold:month=prod_b,pro:week=prod_c,pro:month=prod_d,solo:month=prod_a,nonsense');
    expect(Plans::products())->toBe(['pro' => ['month' => 'prod_a']])
        ->and(Plans::problems())->toHaveCount(5)
        ->and(Plans::problems()[0])->toContain('"gold:month=prod_b"');
    $this->artisan('fitpal:check-config')->expectsOutputToContain('CREEM_PRODUCTS entry "nonsense"')->assertFailed();
});

it('lets an admin and an unlicensed instance write without limit', function () {
    $f = $this->f;
    expect(Entitlement::for($f->a)->toArray())->toMatchArray(['status' => 'unlicensed', 'cap' => null, 'used' => 2, 'canWrite' => true, 'canTakeClient' => true]);
    billingOn();
    expect(Entitlement::for($f->admin)->toArray())->toMatchArray(['status' => 'admin', 'cap' => null, 'canWrite' => true, 'canTakeClient' => true])
        // A client is not limited by their coach's billing.
        ->and(Entitlement::for($f->a1)->toArray())->toMatchArray(['status' => 'client', 'canWrite' => true]);
});

it('gives a coach with no licence nothing to write with', function () {
    billingOn();
    expect(Entitlement::for($this->f->a)->toArray())->toMatchArray(['status' => 'none', 'plan' => null, 'cap' => 0, 'used' => 2, 'canWrite' => false, 'canTakeClient' => false, 'overCap' => true]);
    // A licence that belongs to someone else is no licence.
    $other = licence($this->f->b, ['status' => 'active', 'plan' => 'pro']);
    $this->f->a->forceFill(['licence_id' => $other->id])->save();
    expect(Entitlement::for($this->f->a)->status)->toBe('none');
});

it('writes in trialing, active, past_due and manual, and in canceled until the paid period ends', function (string $status, bool $writes) {
    billingOn();
    licence($this->f->a, ['status' => $status, 'plan' => 'solo', 'period_end' => now()->addDays(3)]);
    expect(Entitlement::for($this->f->a)->canWrite)->toBe($writes);
})->with([
    ['pending', false], ['trialing', true], ['active', true], ['past_due', true], ['unpaid', false],
    ['paused', false], ['canceled', true], ['expired', false], ['manual', true],
]);

it('stops a canceled licence when its period has ended', function () {
    billingOn();
    licence($this->f->a, ['status' => 'canceled', 'plan' => 'pro', 'period_end' => now()->subMinute()]);
    expect(Entitlement::for($this->f->a)->canWrite)->toBeFalse();
});

it('counts active clients against the cap, and keeps an over-cap coach writing', function () {
    $f = $this->f;
    billingOn();
    $this->travelTo('2026-10-22T10:00:00Z');
    licence($f->a, ['status' => 'trialing', 'plan' => 'solo', 'trial_ends_at' => now()->addDays(14), 'period_end' => now()->addDays(14)]);
    expect(Entitlement::for($f->a)->toArray())->toBe([
        'status' => 'trialing', 'plan' => 'solo', 'cap' => 10, 'used' => 2, 'canWrite' => true, 'canTakeClient' => true, 'overCap' => false,
        'trialEndsAt' => '2026-11-05T10:00:00.000Z', 'periodEnd' => '2026-11-05T10:00:00.000Z',
    ]);
    foreach (range(1, 8) as $i) {
        (new User)->forceFill(['id' => User::newId(), 'name' => "c$i", 'coach_id' => $f->a->id])->save();
    }
    expect(Entitlement::for($f->a))->toMatchObject(['used' => 10, 'canTakeClient' => false, 'overCap' => false]);
    // A disabled client frees a seat; one more active client puts the coach over.
    (new User)->forceFill(['id' => User::newId(), 'name' => 'eleventh', 'coach_id' => $f->a->id])->save();
    expect(Entitlement::for($f->a))->toMatchObject(['used' => 11, 'canWrite' => true, 'canTakeClient' => false, 'overCap' => true]);
});

it('tells the app about billing in /api/config', function () {
    $this->getJson('/api/config')->assertJsonPath('billing', false)->assertJsonPath('plans', [])->assertJsonPath('trial_days', 14);
    billingOn('studio:year=prod_ty');
    $this->getJson('/api/config')->assertJsonPath('billing', true)->assertJsonPath('plans', [['plan' => 'studio', 'cap' => 75, 'periods' => ['year']]]);
});
