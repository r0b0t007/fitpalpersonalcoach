<?php

// Plans and Entitlement (CHW-266, spec §2 and §6): what is sold, when billing is on, and what a
// coach may do under each licence status — in the spec's rule order.

use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Models\BillingEvent;
use App\Models\Licence;
use App\Models\User;
use Tests\Support\Billing;
use Tests\Support\Coaching;

function billingOn(string $products = Billing::PRODUCTS): void
{
    Billing::on($products);
}

function licence(User $coach, array $fields): Licence
{
    return Billing::licence($coach, $fields);
}

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    config(['fitpal.creem.api_key' => '', 'fitpal.creem.webhook_secret' => '', 'fitpal.creem.products' => '', 'fitpal.free_cap' => 0]);
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
    billingOn('pro:month=prod_a,gold:month=prod_b,pro:week=prod_c,pro:month=prod_d,studio:year=prod_ok,nonsense');
    expect(Plans::products())->toBe(['pro' => ['month' => 'prod_a'], 'studio' => ['year' => 'prod_ok']])
        ->and(Plans::problems())->toHaveCount(4)
        ->and(Plans::problems()[0])->toContain('"gold:month=prod_b"');
    $this->artisan('fitpal:check-config')->expectsOutputToContain('CREEM_PRODUCTS entry "nonsense"')->assertFailed();
    // One product id for two tiers: refused for both — a webhook could not tell which was bought.
    billingOn('studio:month=prod_a,solo:month=prod_a,pro:year=prod_p');
    expect(Plans::products())->toBe(['pro' => ['year' => 'prod_p']])
        ->and(Plans::fromProduct('prod_a'))->toBeNull();
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

it('tells the app about billing and the Free plan in /api/config', function () {
    $this->getJson('/api/config')->assertJsonPath('billing', false)->assertJsonPath('plans', [])->assertJsonPath('free_cap', 0)
        ->assertJsonMissingPath('trial_days');
    billingOn('studio:year=prod_ty');
    $this->getJson('/api/config')->assertJsonPath('billing', true)->assertJsonPath('plans', [['plan' => 'studio', 'cap' => 75, 'periods' => ['year']]]);
});

it('offers Free first whenever FREE_CAP is set, with billing off or on', function () {
    config(['fitpal.free_cap' => 3]);
    expect(Plans::freeCap())->toBe(3)
        ->and(Plans::offered())->toBe([['plan' => 'free', 'cap' => 3, 'periods' => []]]);
    billingOn('pro:month=prod_pm');
    expect(Plans::offered())->toBe([
        ['plan' => 'free', 'cap' => 3, 'periods' => []],
        ['plan' => 'pro', 'cap' => 30, 'periods' => ['month']],
    ]);
    $this->getJson('/api/config')->assertJsonPath('free_cap', 3)->assertJsonPath('plans.0.plan', 'free');
    // A negative or junk value is off, never a cap below zero.
    config(['fitpal.free_cap' => -2]);
    expect(Plans::freeCap())->toBe(0);
});

it('says billing is off when CREEM_PRODUCTS names nothing it can sell', function () {
    billingOn('Solo:month=prod_x, pro:monthly=prod_y');
    expect(Plans::billingOn())->toBeFalse()
        ->and(Plans::problems()[0])->toBe('billing is off: CREEM_PRODUCTS is not set, while CREEM_API_KEY and CREEM_WEBHOOK_SECRET are. Set all three, or none.');
    billingOn(',');
    expect(Plans::problems())->toContain('CREEM_PRODUCTS holds no entry at all.');
});

it('stops a Creem licence that has heard nothing for GRACE_DAYS past its period, but never a manual one', function () {
    billingOn();
    $l = licence($this->f->a, ['status' => 'active', 'plan' => 'pro', 'period_end' => now()->subDays(Entitlement::GRACE_DAYS - 1)]);
    expect(Entitlement::for($this->f->a)->canWrite)->toBeTrue();
    $l->forceFill(['period_end' => now()->subDays(Entitlement::GRACE_DAYS + 1)])->save();
    expect(Entitlement::for($this->f->a)->canWrite)->toBeFalse();
    $l->forceFill(['source' => 'manual', 'status' => 'manual'])->save();
    expect(Entitlement::for($this->f->a)->canWrite)->toBeTrue();
});

it('writes nothing and takes no client on a plan it does not sell, without calling the coach over a cap', function () {
    billingOn();
    licence($this->f->a, ['status' => 'manual', 'source' => 'manual', 'plan' => 'gold']);
    expect(Entitlement::for($this->f->a))->toMatchObject(['canWrite' => false, 'cap' => 0, 'canTakeClient' => false, 'overCap' => false])
        ->and(Entitlement::canWrite($this->f->a))->toBeFalse()
        ->and(Entitlement::for($this->f->a1)->cap)->toBeNull();   // a client: not limited
});

it('keeps the newest webhook ids and prunes the rest', function () {
    foreach (range(1, BillingEvent::KEEP + 5) as $i) {
        $rows[] = ['id' => "evt_$i", 'at' => now()->subSeconds(10000 - $i)->format('Y-m-d H:i:s.v')];
    }
    foreach (array_chunk($rows, 300) as $chunk) {
        BillingEvent::query()->insert($chunk);
    }
    $this->artisan('fitpal:prune')->assertSuccessful();
    expect(BillingEvent::query()->count())->toBe(BillingEvent::KEEP)
        ->and(BillingEvent::query()->find('evt_1'))->toBeNull()
        ->and(BillingEvent::query()->find('evt_'.(BillingEvent::KEEP + 5)))->not->toBeNull();
});

it('puts a coach without a paid plan on Free when FREE_CAP is set, billing off or on', function () {
    $f = $this->f;
    config(['fitpal.free_cap' => 3]);
    // Billing off: Free, not unlicensed.
    expect(Entitlement::for($f->a)->toArray())->toMatchArray(['status' => 'free', 'plan' => 'free', 'cap' => 3, 'used' => 2, 'canWrite' => true, 'canTakeClient' => true, 'overCap' => false])
        ->and(Entitlement::canWrite($f->a))->toBeTrue();
    // Billing on and no licence: Free too, where it used to be read-only.
    billingOn();
    expect(Entitlement::for($f->a))->toMatchObject(['status' => 'free', 'cap' => 3, 'canWrite' => true]);
    // A third client fills it; a fourth puts the coach over, still writable.
    (new User)->forceFill(['id' => User::newId(), 'name' => 'third', 'coach_id' => $f->a->id])->save();
    expect(Entitlement::for($f->a))->toMatchObject(['used' => 3, 'canTakeClient' => false, 'overCap' => false])
        ->and(Entitlement::for($f->a)->seatRefusal())->toBe('at_cap');
    (new User)->forceFill(['id' => User::newId(), 'name' => 'fourth', 'coach_id' => $f->a->id])->save();
    expect(Entitlement::for($f->a))->toMatchObject(['used' => 4, 'canWrite' => true, 'canTakeClient' => false, 'overCap' => true]);
});

it('keeps a paying coach on their plan, and drops one whose plan lapsed to Free', function () {
    $f = $this->f;
    config(['fitpal.free_cap' => 3]);
    billingOn();
    licence($f->a, ['status' => 'active', 'plan' => 'pro']);
    expect(Entitlement::for($f->a))->toMatchObject(['status' => 'active', 'plan' => 'pro', 'cap' => 30]);
    // Over: canceled and its period gone. Free, with nothing left to bill.
    licence($f->a, ['status' => 'canceled', 'plan' => 'pro', 'period_end' => now()->subDay()]);
    expect(Entitlement::for($f->a))->toMatchObject(['status' => 'free', 'plan' => 'free', 'cap' => 3, 'canWrite' => true]);
});

it('keeps a subscription Creem can still bill under its own status, with Free\'s allowance', function (string $status) {
    $f = $this->f;
    config(['fitpal.free_cap' => 3]);
    billingOn();
    licence($f->a, ['status' => $status, 'plan' => 'pro']);
    // Its fix is the card in the portal, not a new checkout (which the server refuses): the app has
    // to see `paused`/`unpaid` to offer it. Meanwhile the coach works as on Free.
    expect(Entitlement::for($f->a))->toMatchObject(['status' => $status, 'plan' => 'pro', 'cap' => 3, 'used' => 2, 'canWrite' => true, 'canTakeClient' => true]);
})->with(['paused', 'unpaid']);

it('leaves admins exempt, and billing-off coaches unlimited while FREE_CAP is unset', function () {
    $f = $this->f;
    expect(Entitlement::for($f->a))->toMatchObject(['status' => 'unlicensed', 'cap' => null]);
    config(['fitpal.free_cap' => 3]);
    $f->a->forceFill(['admin' => true])->save();
    expect(Entitlement::for($f->a->refresh()))->toMatchObject(['status' => 'admin', 'cap' => null]);
});

it('warns in check-config when the Free plan is as big as the smallest paid one', function () {
    config(['fitpal.free_cap' => 10]);
    $this->artisan('fitpal:check-config')->expectsOutputToContain('FREE_CAP (10) is not below the smallest paid plan (Solo, 10)');
    config(['fitpal.free_cap' => 3]);
    $this->artisan('fitpal:check-config')->doesntExpectOutputToContain('FREE_CAP (');
});
