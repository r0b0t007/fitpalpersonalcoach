<?php

// Creem's webhook (CHW-270, spec §6): the signature, idempotency, who an event is for, and what each
// event does to the licence. Payloads are shaped as docs.creem.io/code/webhooks documents them.

use App\Domain\Entitlement;
use App\Models\BillingEvent;
use App\Models\Licence;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Billing;
use Tests\Support\Coaching;

const WHSEC = 'whsec_test';

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    Billing::on();
    $this->seq = 0;
});

/** The raw body, signed as Creem signs it (hex HMAC-SHA256 of the body). */
function deliver(array $event, ?string $signature = null, array $headers = []): TestResponse
{
    $raw = json_encode($event);
    $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
    if ($signature !== '') {
        $server['HTTP_CREEM_SIGNATURE'] = $signature ?? hash_hmac('sha256', $raw, WHSEC);
    }
    foreach ($headers as $k => $v) {
        $server['HTTP_'.strtoupper(str_replace('-', '_', $k))] = $v;
    }

    return test()->call('POST', '/api/billing/webhook', [], [], [], $server, $raw);
}

/** A subscription object as Creem sends it, for $coach's checkout. */
function creemSubscription(User $coach, array $over = []): array
{
    return $over + [
        'id' => 'sub_1', 'object' => 'subscription', 'status' => 'active',
        'product' => ['id' => 'prod_pm', 'billing_period' => 'every-month'],
        'customer' => ['id' => 'cust_1', 'email' => 'coach@example.com'],
        'current_period_start_date' => '2026-10-22T10:00:00.000Z',
        'current_period_end_date' => '2026-11-22T10:00:00.000Z',
        'canceled_at' => null,
        'metadata' => ['userId' => $coach->id, 'plan' => 'pro', 'period' => 'month'],
        'mode' => 'test',
    ];
}

/** An event envelope; each one later than the last, unless $at says otherwise. */
function creemEvent(string $type, array $object, ?int $at = null): array
{
    $t = test();
    $t->seq++;

    return ['id' => 'evt_'.$t->seq.'_'.bin2hex(random_bytes(3)), 'eventType' => $type, 'created_at' => $at ?? (1792700000000 + $t->seq * 1000), 'object' => $object];
}

/** The pending row a checkout leaves (BillingController::checkout). */
function pendingCheckout(User $coach, string $product = 'prod_pm', string $checkout = 'ch_1', string $request = 'req_1'): Licence
{
    return Billing::licence($coach, ['status' => 'pending', 'plan' => 'pro', 'period' => 'month', 'creem_product_id' => $product, 'checkout_id' => $checkout, 'request_id' => $request]);
}

function checkoutCompleted(User $coach, array $sub = [], string $checkout = 'ch_1', string $request = 'req_1'): array
{
    return creemEvent('checkout.completed', [
        'id' => $checkout, 'object' => 'checkout', 'request_id' => $request, 'status' => 'completed',
        'product' => ['id' => $sub['product']['id'] ?? 'prod_pm'],
        'customer' => ['id' => 'cust_1'],
        'subscription' => creemSubscription($coach, $sub),
        'metadata' => ['userId' => $coach->id, 'plan' => 'pro', 'period' => 'month'],
    ]);
}

it('refuses a missing, wrong or tampered signature before reading the body, and answers 404 without Creem', function () {
    $e = checkoutCompleted($this->f->a);
    deliver($e, '')->assertStatus(401)->assertExactJson(['error' => 'invalid signature']);
    deliver($e, 'deadbeef')->assertStatus(401);
    deliver($e, hash_hmac('sha256', json_encode($e), 'another_secret'))->assertStatus(401);
    // The same body with one byte changed after signing.
    $raw = json_encode($e);
    $sig = hash_hmac('sha256', $raw, WHSEC);
    $this->call('POST', '/api/billing/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_CREEM_SIGNATURE' => $sig], str_replace('"completed"', '"complete!"', $raw))->assertStatus(401);
    expect(BillingEvent::query()->count())->toBe(0);
    // An upper-case hex signature is the same signature.
    deliver($e, strtoupper(hash_hmac('sha256', json_encode($e), WHSEC)))->assertOk();
    config(['fitpal.creem.webhook_secret' => '']);
    deliver($e)->assertStatus(404);
});

it('is refused when a browser page forges it, before the signature is looked at', function () {
    deliver(checkoutCompleted($this->f->a), 'x', ['Origin' => 'https://evil.example'])->assertStatus(403);
});

it('refuses a signed body that is not a Creem event', function (array $body) {
    deliver($body)->assertStatus(400)->assertExactJson(['error' => 'not a Creem event']);
})->with([
    'no id' => [['eventType' => 'subscription.paid', 'created_at' => 1, 'object' => []]],
    'no type' => [['id' => 'evt_1', 'created_at' => 1, 'object' => []]],
    'no object' => [['id' => 'evt_1', 'eventType' => 'subscription.paid', 'created_at' => 1]],
    'no time' => [['id' => 'evt_1', 'eventType' => 'subscription.paid', 'object' => []]],
]);

it('licenses the coach when the checkout completes: the pending row comes to life', function () {
    $f = $this->f;
    $row = pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a, ['status' => 'trialing']))->assertOk()->assertExactJson(['ok' => true]);
    $row->refresh();
    expect($row->only(['status', 'plan', 'period', 'creem_subscription_id', 'creem_customer_id', 'creem_product_id']))
        ->toBe(['status' => 'trialing', 'plan' => 'pro', 'period' => 'month', 'creem_subscription_id' => 'sub_1', 'creem_customer_id' => 'cust_1', 'creem_product_id' => 'prod_pm'])
        ->and($row->trial_ends_at?->toIso8601ZuluString())->toBe('2026-11-22T10:00:00Z')
        ->and($row->period_end?->toIso8601ZuluString())->toBe('2026-11-22T10:00:00Z')
        ->and($f->a->fresh()->licence_id)->toBe($row->id)
        ->and(Entitlement::for($f->a->fresh())->toArray())->toMatchArray(['status' => 'trialing', 'cap' => 30, 'canWrite' => true]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.event', 'uid' => $f->a->id, 'msg' => 'checkout.completed']);
    $this->postJson('/api/coach/invites/new', [], bearer($f->a->fresh()))->assertOk();
});

it('answers a second delivery of one event as a duplicate and changes nothing', function () {
    $f = $this->f;
    pendingCheckout($f->a);
    $e = checkoutCompleted($f->a);
    deliver($e)->assertOk();
    Licence::query()->update(['status' => 'paused']);   // a later change the duplicate must not undo
    deliver($e)->assertOk()->assertExactJson(['ok' => true, 'duplicate' => true]);
    expect(Licence::query()->first()->status)->toBe('paused')
        ->and(BillingEvent::query()->count())->toBe(1)
        ->and(DB::table('audit_events')->where('ev', 'billing.event')->count())->toBe(1);
});

it('follows the subscription through its life', function (string $type, array $sub, string $status, bool $writes) {
    $f = $this->f;
    pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a))->assertOk();
    deliver(creemEvent($type, creemSubscription($f->a, $sub)))->assertOk();
    $licence = Licence::query()->find($f->a->fresh()->licence_id);
    expect($licence->status)->toBe($status)
        ->and(Entitlement::for($f->a->fresh())->canWrite)->toBe($writes);
})->with([
    'paid: a renewal' => ['subscription.paid', [], 'active', true],
    'active' => ['subscription.active', [], 'active', true],
    'trialing' => ['subscription.trialing', ['status' => 'trialing'], 'trialing', true],
    'past due: Creem is retrying' => ['subscription.past_due', ['status' => 'past_due'], 'past_due', true],
    'unpaid' => ['subscription.unpaid', ['status' => 'unpaid'], 'unpaid', false],
    'paused' => ['subscription.paused', ['status' => 'paused'], 'paused', false],
    'expired' => ['subscription.expired', ['status' => 'expired'], 'expired', false],
    'canceled, paid until a future date' => ['subscription.canceled', ['status' => 'canceled', 'canceled_at' => '2026-10-23T10:00:00.000Z', 'current_period_end_date' => '2099-01-01T00:00:00.000Z'], 'canceled', true],
    'canceled, period over' => ['subscription.canceled', ['status' => 'canceled', 'current_period_end_date' => '2026-01-01T00:00:00.000Z'], 'canceled', false],
]);

it('moves the period on with each renewal, so the stale net never retires a paying coach', function () {
    $f = $this->f;
    pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a))->assertOk();
    deliver(creemEvent('subscription.paid', creemSubscription($f->a, ['current_period_start_date' => '2026-11-22T10:00:00.000Z', 'current_period_end_date' => '2026-12-22T10:00:00.000Z'])))->assertOk();
    expect(Licence::query()->first()->period_end->toIso8601ZuluString())->toBe('2026-12-22T10:00:00Z');
});

it('notes a cancellation scheduled for the period end, and keeps writing until then', function () {
    $f = $this->f;
    pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a))->assertOk();
    deliver(creemEvent('subscription.scheduled_cancel', creemSubscription($f->a, ['status' => 'scheduled_cancel'])))->assertOk();
    $licence = Licence::query()->first();
    expect($licence->status)->toBe('active')
        ->and($licence->cancel_at?->toIso8601ZuluString())->toBe('2026-11-22T10:00:00Z')
        ->and(Entitlement::for($f->a->fresh())->canWrite)->toBeTrue();
});

it('changes the plan when the subscription moves to another product, and leaves it for one not on sale', function () {
    $f = $this->f;
    pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a))->assertOk();
    deliver(creemEvent('subscription.update', creemSubscription($f->a, ['product' => ['id' => 'prod_ty']])))->assertOk();
    expect(Licence::query()->first()->only(['plan', 'period', 'creem_product_id']))->toBe(['plan' => 'studio', 'period' => 'year', 'creem_product_id' => 'prod_ty']);
    deliver(creemEvent('subscription.update', creemSubscription($f->a, ['product' => ['id' => 'prod_retired']])))->assertOk();
    expect(Licence::query()->first()->plan)->toBe('studio');
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.unsold', 'uid' => $f->a->id, 'msg' => 'prod_retired']);
});

it('records an older event that arrives late, without applying it', function () {
    $f = $this->f;
    pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a))->assertOk();
    $late = creemEvent('subscription.past_due', creemSubscription($f->a, ['status' => 'past_due']), 1792699999000);
    deliver(creemEvent('subscription.paid', creemSubscription($f->a)))->assertOk();
    deliver($late)->assertOk()->assertExactJson(['ok' => true, 'stale' => true]);
    expect(Licence::query()->first()->status)->toBe('active')
        ->and(BillingEvent::query()->find($late['id']))->not->toBeNull();
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.stale', 'msg' => 'subscription.past_due']);
});

it('finds the coach without metadata: by subscription, by customer, by checkout request', function (string $how) {
    $f = $this->f;
    $row = pendingCheckout($f->a);
    $row->forceFill(['creem_subscription_id' => 'sub_1', 'creem_customer_id' => 'cust_1', 'status' => 'active'])->save();
    $sub = creemSubscription($f->a, ['status' => 'paused', 'metadata' => []]);
    $e = match ($how) {
        'subscription' => creemEvent('subscription.paused', $sub),
        'customer' => creemEvent('subscription.paused', ['id' => 'sub_unknown'] + $sub),
        'request' => creemEvent('checkout.completed', ['id' => 'ch_9', 'request_id' => 'req_1', 'customer' => 'cust_x', 'metadata' => [],
            'subscription' => ['id' => 'sub_1', 'customer' => 'cust_x', 'status' => 'paused', 'product' => 'prod_pm', 'metadata' => []]]),
    };
    if ($how === 'request') {
        $row->forceFill(['creem_subscription_id' => null, 'creem_customer_id' => null])->save();
    }
    deliver($e)->assertOk()->assertExactJson(['ok' => true]);
    if ($how === 'customer') {
        // Their customer, but a subscription we have never seen: it is theirs, on a row of its own —
        // the one they pay for now is not overwritten, and a paused one does not take over.
        expect($row->fresh()->status)->toBe('active')
            ->and(Licence::query()->where('creem_subscription_id', 'sub_unknown')->value('status'))->toBe('paused')
            ->and($f->a->fresh()->licence_id)->toBe($row->id);
    } else {
        expect($row->fresh()->status)->toBe('paused');
    }
})->with(['subscription', 'customer', 'request']);

it('acknowledges an event for nobody it knows, and tells the owner', function () {
    $sub = creemSubscription($this->f->a, ['id' => 'sub_x', 'customer' => ['id' => 'cust_x'], 'metadata' => []]);
    deliver(creemEvent('subscription.paid', $sub))->assertOk()->assertExactJson(['ok' => true]);
    // A metadata userId that is not a coach is nobody either.
    deliver(creemEvent('subscription.paid', ['metadata' => ['userId' => $this->f->a1->id]] + $sub))->assertOk();
    expect(Licence::query()->count())->toBe(0)
        ->and(DB::table('audit_events')->where('ev', 'billing.orphan')->where('ok', false)->count())->toBe(2);
});

it('never takes the licence away from a grant: a payment on a granted coach is told to the owner', function () {
    $f = $this->f;
    $old = pendingCheckout($f->a);
    $this->postJson('/api/admin/licence/grant', ['id' => $f->a->id, 'plan' => 'pro'], bearer($f->admin))->assertOk();
    $grant = $f->a->fresh()->licence_id;
    // The checkout from a tab left open is paid after the grant.
    deliver(checkoutCompleted($f->a))->assertOk();
    expect($f->a->fresh()->licence_id)->toBe($grant)
        ->and($old->fresh()->status)->toBe('active');
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.conflict', 'uid' => $f->a->id, 'msg' => $old->id]);
});

it('follows the coach to the checkout they paid, among several they opened', function () {
    $f = $this->f;
    $month = pendingCheckout($f->a, 'prod_pm', 'ch_1', 'req_1');
    $year = pendingCheckout($f->a, 'prod_py', 'ch_2', 'req_2');   // licence_id now points here
    deliver(checkoutCompleted($f->a, [], 'ch_1', 'req_1'))->assertOk();
    expect($f->a->fresh()->licence_id)->toBe($month->id)
        ->and($year->fresh()->status)->toBe('pending');
});

it('lets a subscription event that beat its checkout.completed find the pending row', function () {
    $f = $this->f;
    $row = pendingCheckout($f->a);
    deliver(creemEvent('subscription.active', creemSubscription($f->a)))->assertOk();
    expect($row->fresh()->only(['status', 'creem_subscription_id']))->toBe(['status' => 'active', 'creem_subscription_id' => 'sub_1']);
    deliver(checkoutCompleted($f->a))->assertOk();
    expect(Licence::query()->count())->toBe(1);
});

it('tells the owner of a refund and a dispute, and marks a disputed licence, changing nothing else', function () {
    $f = $this->f;
    pendingCheckout($f->a);
    deliver(checkoutCompleted($f->a))->assertOk();
    deliver(creemEvent('refund.created', ['id' => 'ref_1', 'object' => 'refund', 'subscription' => 'sub_1', 'customer' => 'cust_1', 'metadata' => ['userId' => $f->a->id]]))->assertOk();
    deliver(creemEvent('dispute.created', ['id' => 'dsp_1', 'object' => 'dispute', 'subscription' => ['id' => 'sub_1'], 'customer' => ['id' => 'cust_1']]))->assertOk();
    $licence = Licence::query()->first();
    expect($licence->status)->toBe('active')->and($licence->disputed)->toBeTrue();
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.refund', 'uid' => $f->a->id, 'msg' => 'ref_1']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.dispute', 'uid' => $f->a->id, 'msg' => 'dsp_1']);
});

it('acknowledges an event it has no use for', function () {
    deliver(creemEvent('credits.granted', ['id' => 'cr_1', 'customer' => 'cust_1', 'metadata' => ['userId' => $this->f->a->id]]))->assertOk();
    expect(Licence::query()->count())->toBe(0);
    $this->assertDatabaseHas('audit_events', ['ev' => 'billing.ignored', 'msg' => 'credits.granted']);
});
