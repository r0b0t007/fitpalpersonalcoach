<?php

// Paying for the plan (CHW-269, spec §6): POST /api/billing/checkout, GET /api/billing/me, POST
// /api/billing/portal, and the Creem client under them. Creem is faked: nothing leaves the suite.

use App\Billing\Creem;
use App\Http\Controllers\BillingController;
use App\Models\Licence;
use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use Tests\Support\Billing;
use Tests\Support\Coaching;

const CHECKOUT_URL = 'https://checkout.creem.io/test/ch_1';

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    Billing::on();
    config(['fitpal.origin' => 'https://lab.example']);
    Http::preventStrayRequests();
});

function checkoutAs(User $who, array $body = ['plan' => 'pro', 'period' => 'month']): TestResponse
{
    return test()->postJson('/api/billing/checkout', $body, bearer($who));
}

/** Creem's checkout endpoint, faked: by default each session its own id and URL (ch_1, ch_2…). */
function creemCheckouts(mixed $answer = null): void
{
    $n = 0;
    Http::fake(['test-api.creem.io/v1/checkouts' => $answer ?? function () use (&$n) {
        $n++;

        return Http::response(['id' => "ch_$n", 'checkout_url' => $n === 1 ? CHECKOUT_URL : CHECKOUT_URL."_$n", 'status' => 'pending']);
    }]);
}

it('opens a Creem checkout for the plan and leaves a pending licence pointing at it', function () {
    $f = $this->f;
    creemCheckouts();
    $f->a->forceFill(['email' => 'coach.a@example.com'])->save();
    checkoutAs($f->a)->assertOk()->assertExactJson(['url' => CHECKOUT_URL]);

    Http::assertSent(function (ClientRequest $r) use ($f) {
        return $r->url() === 'https://test-api.creem.io/v1/checkouts' && $r->method() === 'POST'
            && $r->header('x-api-key') === ['creem_test_key']
            && $r['product_id'] === 'prod_pm'
            && str_starts_with($r['request_id'], 'req_')
            && $r['success_url'] === 'https://lab.example/'
            && $r['metadata'] === ['userId' => $f->a->id, 'plan' => 'pro', 'period' => 'month']
            && $r['customer'] === ['email' => 'coach.a@example.com'];
    });
    $licence = Licence::query()->find($f->a->fresh()->licence_id);
    expect($licence)->toMatchArray([
        'user_id' => $f->a->id, 'source' => 'creem', 'status' => 'pending', 'plan' => 'pro', 'period' => 'month',
        'creem_product_id' => 'prod_pm', 'checkout_id' => 'ch_1', 'checkout_url' => CHECKOUT_URL,
    ])->and($licence->request_id)->toStartWith('req_')
        ->and($licence->checkout_at)->not->toBeNull();
    // Still nothing to write with: the webhook licenses them (CHW-270).
    $this->postJson('/api/coach/invites/new', [], bearer($f->a))->assertStatus(402);
});

it('sends no customer block for a coach without an email', function () {
    creemCheckouts();
    checkoutAs($this->f->a)->assertOk();
    Http::assertSent(fn (ClientRequest $r) => ! isset($r['customer']));
});

it('hands out the same checkout for a second tap within 30 minutes, and a new one after', function () {
    $f = $this->f;
    creemCheckouts();
    checkoutAs($f->a)->assertOk();
    checkoutAs($f->a)->assertOk()->assertExactJson(['url' => CHECKOUT_URL]);
    Http::assertSentCount(1);
    $first = $f->a->fresh()->licence_id;

    // Another period is another checkout on a new row; the first keeps its session, which the
    // webhook can still match should it be paid after all.
    checkoutAs($f->a, ['plan' => 'pro', 'period' => 'year'])->assertOk()->assertExactJson(['url' => CHECKOUT_URL.'_2']);
    Http::assertSentCount(2);
    expect(Licence::query()->find($first))->toMatchArray(['status' => 'pending', 'checkout_id' => 'ch_1', 'period' => 'month']);
    $this->travel(31)->minutes();
    checkoutAs($f->a, ['plan' => 'pro', 'period' => 'year'])->assertOk()->assertExactJson(['url' => CHECKOUT_URL.'_3']);
    Http::assertSentCount(3);
    expect(Licence::query()->count())->toBe(3)
        ->and(Licence::query()->find($f->a->fresh()->licence_id)->checkout_id)->toBe('ch_3');
});

it('does not hand out a checkout for a product that is no longer the one on sale', function () {
    $f = $this->f;
    creemCheckouts();
    checkoutAs($f->a)->assertOk();
    // A price change: pro monthly is another product now (or the store moved from test to live).
    Billing::on(str_replace('prod_pm', 'prod_pm2', Billing::PRODUCTS));
    checkoutAs($f->a)->assertOk()->assertExactJson(['url' => CHECKOUT_URL.'_2']);
    Http::assertSentCount(2);
    Http::assertSent(fn (ClientRequest $r) => $r['product_id'] === 'prod_pm2');
});

it('opens one checkout at a time per coach: a double tap waits for the first', function () {
    $f = $this->f;
    $heldDuringCall = null;
    creemCheckouts(function () use ($f, &$heldDuringCall) {
        // While Creem is answering, the coach's checkout lock is taken: a second tap would wait.
        $heldDuringCall = ! Cache::lock('billing:checkout:'.$f->a->id, 1)->get();

        return Http::response(['id' => 'ch_1', 'checkout_url' => CHECKOUT_URL]);
    });
    checkoutAs($f->a)->assertOk();
    expect($heldDuringCall)->toBeTrue();

    // A tap that waited too long is told to try again, with nothing sent or written.
    $held = Cache::lock('billing:checkout:'.$f->b->id, 30);
    $held->get();
    BillingController::$lockWait = 0;
    try {
        checkoutAs($f->b)->assertStatus(502);
    } finally {
        BillingController::$lockWait = 20;
        $held->release();
    }
    Http::assertSentCount(1);
    expect($f->b->fresh()->licence_id)->toBeNull();
});

it('sells a new plan, and lets the owner grant one, when a Creem licence went stale', function () {
    $f = $this->f;
    creemCheckouts();
    // "Active", but its period ended long ago and Creem said nothing since: a webhook lost for good.
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'pro', 'period_end' => now()->subDays(Licence::GRACE_DAYS + 1)]);
    checkoutAs($f->a)->assertOk();
    Billing::licence($f->b, ['status' => 'past_due', 'plan' => 'pro', 'period_end' => now()->subDays(Licence::GRACE_DAYS + 1)]);
    $this->postJson('/api/admin/licence/grant', ['id' => $f->b->id, 'plan' => 'pro'], bearer($f->admin))->assertOk();
});

it('refuses a client, an admin, an instance without billing, and a plan it does not sell — asking Creem nothing', function () {
    $f = $this->f;
    Http::fake();
    checkoutAs($f->a1)->assertStatus(403);
    checkoutAs($f->admin)->assertStatus(400)->assertExactJson(['error' => 'an admin needs no plan']);
    foreach ([['plan' => 'gold', 'period' => 'month'], ['plan' => 'pro', 'period' => 'week'], ['plan' => ['pro'], 'period' => 'month'], []] as $body) {
        checkoutAs($f->a, $body)->assertStatus(400)->assertExactJson(['error' => 'no such plan']);
    }
    // A plan that exists but is not on sale here.
    Billing::on('pro:month=prod_pm,solo:month=prod_sm,studio:month=prod_tm');
    checkoutAs($f->a, ['plan' => 'pro', 'period' => 'year'])->assertStatus(400);
    config(['fitpal.creem.api_key' => '']);
    checkoutAs($f->a)->assertStatus(404)->assertExactJson(['error' => 'billing is not set up on this server']);
    Http::assertNothingSent();
    expect(Licence::query()->count())->toBe(0);
});

it('does not sell a second plan to a coach who has one, or whose subscription can still bill', function (array $licence) {
    Http::fake();
    Billing::licence($this->f->a, $licence + ['plan' => 'solo']);
    checkoutAs($this->f->a)->assertStatus(409)->assertExactJson(['error' => 'you already have a plan — see Account › Plan & billing']);
    Http::assertNothingSent();
})->with([
    'trialing' => [['status' => 'trialing']],
    'active' => [['status' => 'active']],
    'past due' => [['status' => 'past_due']],
    'paused (update the card in the portal)' => [['status' => 'paused']],
    'unpaid' => [['status' => 'unpaid']],
    'canceled, paid until next week' => [['status' => 'canceled', 'period_end' => now()->addWeek()]],
    'granted by hand' => [['status' => 'manual', 'source' => 'manual']],
]);

it('sells a plan again once the last one is over, keeping the old row', function (array $over) {
    creemCheckouts();
    $old = Billing::licence($this->f->a, $over + ['plan' => 'solo']);
    checkoutAs($this->f->a)->assertOk();
    expect($this->f->a->fresh()->licence_id)->not->toBe($old->id)
        ->and($old->fresh()->status)->toBe($over['status']);
})->with([
    'expired' => [['status' => 'expired']],
    'canceled, period over' => [['status' => 'canceled', 'period_end' => now()->subDay()]],
    'a revoked grant' => [['status' => 'revoked', 'source' => 'manual']],
]);

it('answers 502 and writes nothing when Creem fails, and logs why without the key', function (mixed $answer) {
    $f = $this->f;
    Log::spy();
    creemCheckouts($answer);
    checkoutAs($f->a)->assertStatus(502)->assertExactJson(['error' => 'the payment service did not answer — try again in a moment']);
    expect(Licence::query()->count())->toBe(0)->and($f->a->fresh()->licence_id)->toBeNull();
    Log::shouldHaveReceived('warning')->withArgs(fn ($message, $context) => $message === 'creem checkout failed'
        && ! str_contains(json_encode($context), 'creem_test_key'))->once();
})->with([
    // Closures in closures: Pest calls a dataset's closure up front; the inner one is Creem's answer.
    'a 500' => [fn () => fn () => Http::response(['error' => 'boom'], 500)],
    'a 401' => [fn () => fn () => Http::response(['message' => 'Unauthorized'], 401)],
    'no connection' => [fn () => fn () => throw new ConnectionException('timed out')],
    'no checkout_url' => [fn () => fn () => Http::response(['id' => 'ch_1'])],
    'a checkout_url that is not https' => [fn () => fn () => Http::response(['id' => 'ch_1', 'checkout_url' => 'http://evil.example/'])],
    'not JSON' => [fn () => fn () => Http::response('<html>', 200)],
]);

it('writes no pending row over a licence that arrived while Creem was answering', function () {
    $f = $this->f;
    creemCheckouts(function () use ($f) {
        // The webhook licenses them mid-call (another request, committed).
        Billing::licence(User::query()->find($f->a->id), ['status' => 'active', 'plan' => 'pro']);

        return Http::response(['id' => 'ch_1', 'checkout_url' => CHECKOUT_URL]);
    });
    checkoutAs($f->a)->assertStatus(409);
    expect(Licence::query()->find($f->a->fresh()->licence_id)->status)->toBe('active')
        ->and(Licence::query()->count())->toBe(1);
});

it('tells the coach what their licence says, without Creem ids or the checkout URL', function () {
    $f = $this->f;
    config(['fitpal.creem.api_key' => '']);
    $this->getJson('/api/billing/me', bearer($f->a))->assertOk()->assertExactJson([
        'entitlement' => ['status' => 'unlicensed', 'plan' => null, 'cap' => null, 'used' => 2, 'canWrite' => true, 'canTakeClient' => true, 'overCap' => false, 'trialEndsAt' => null, 'periodEnd' => null],
        'licence' => null,
        'plans' => [],
        'portal' => false,
    ]);
    Billing::on();
    Billing::licence($f->a, [
        'status' => 'trialing', 'plan' => 'pro', 'period' => 'month', 'creem_customer_id' => 'cust_1', 'creem_subscription_id' => 'sub_1',
        'checkout_url' => CHECKOUT_URL, 'trial_ends_at' => '2026-11-05 10:00:00.000', 'period_end' => '2026-11-05 10:00:00.000',
    ]);
    $res = $this->getJson('/api/billing/me', bearer($f->a))->assertOk();
    expect($res->json('licence'))->toBe([
        'status' => 'trialing', 'plan' => 'pro', 'period' => 'month', 'source' => 'creem',
        'trialEndsAt' => '2026-11-05T10:00:00.000Z', 'periodEnd' => '2026-11-05T10:00:00.000Z',
        'cancelAt' => null, 'canceledAt' => null, 'checkoutAt' => null,
    ])->and($res->json('portal'))->toBeTrue()
        ->and($res->json('entitlement'))->toMatchArray(['status' => 'trialing', 'cap' => 30, 'canWrite' => true])
        ->and($res->json('plans'))->toHaveCount(3)
        ->and($res->getContent())->not->toContain('cust_1')->not->toContain('checkout.creem.io');
    $this->getJson('/api/billing/me', bearer($f->a1))->assertStatus(403);
});

it('opens the Creem portal for a coach with a Creem customer, and only for them', function () {
    $f = $this->f;
    Http::fake(['test-api.creem.io/v1/customers/billing' => Http::response(['customer_portal_link' => 'https://creem.io/test/portal/abc'])]);
    $portal = fn (User $who) => $this->postJson('/api/billing/portal', [], bearer($who));
    $none = ['error' => 'there is no billing account to manage yet — choose a plan first'];
    $portal($f->a)->assertStatus(404)->assertExactJson($none);
    Billing::licence($f->a, ['status' => 'manual', 'source' => 'manual', 'plan' => 'pro']);
    $portal($f->a)->assertStatus(404)->assertExactJson($none);
    Billing::licence($f->a, ['status' => 'pending', 'plan' => 'pro']);   // a checkout never finished: no customer yet
    $portal($f->a)->assertStatus(404);
    Http::assertNothingSent();

    Billing::licence($f->a, ['status' => 'active', 'plan' => 'pro', 'creem_customer_id' => 'cust_1']);
    $portal($f->a)->assertOk()->assertExactJson(['url' => 'https://creem.io/test/portal/abc']);
    Http::assertSent(fn (ClientRequest $r) => $r->url() === 'https://test-api.creem.io/v1/customers/billing' && $r['customer_id'] === 'cust_1');
    $portal($f->admin)->assertStatus(400);
    $portal($f->a1)->assertStatus(403);
});

it('still opens the portal after a checkout was started and abandoned', function () {
    $f = $this->f;
    creemCheckouts();
    Http::fake(['test-api.creem.io/v1/customers/billing' => Http::response(['customer_portal_link' => 'https://creem.io/test/portal/abc'])]);
    Billing::licence($f->a, ['status' => 'expired', 'plan' => 'pro', 'creem_customer_id' => 'cust_1']);
    checkoutAs($f->a)->assertOk();   // licence_id now points at a pending row with no customer
    $this->getJson('/api/billing/me', bearer($f->a))->assertJsonPath('licence.status', 'pending')->assertJsonPath('portal', true);
    $this->postJson('/api/billing/portal', [], bearer($f->a))->assertOk();
    Http::assertSent(fn (ClientRequest $r) => str_ends_with($r->url(), '/v1/customers/billing') && $r['customer_id'] === 'cust_1');
});

it('answers 502 when the portal link cannot be had', function () {
    Http::fake(['test-api.creem.io/v1/customers/billing' => Http::response([], 503)]);
    Billing::licence($this->f->a, ['status' => 'active', 'plan' => 'pro', 'creem_customer_id' => 'cust_1']);
    $this->postJson('/api/billing/portal', [], bearer($this->f->a))->assertStatus(502);
});

it('talks to the store the key belongs to, unless CREEM_API_BASE says otherwise', function () {
    config(['fitpal.creem.api_base' => '', 'fitpal.creem.api_key' => 'creem_test_abc']);
    expect(Creem::base())->toBe('https://test-api.creem.io');
    config(['fitpal.creem.api_key' => 'creem_abc']);
    expect(Creem::base())->toBe('https://api.creem.io');
    config(['fitpal.creem.api_base' => 'https://creem.internal']);
    expect(Creem::base())->toBe('https://creem.internal')->and(Creem::problems())->toBe([]);
    // A base for the other store than the key's: every call would be a 401. check-config says so.
    config(['fitpal.creem.api_base' => Creem::TEST_BASE, 'fitpal.creem.api_key' => 'creem_live']);
    expect(Creem::problems())->toHaveCount(1)->and(Creem::problems()[0])->toContain('live key');
    config(['fitpal.creem.api_base' => Creem::LIVE_BASE, 'fitpal.creem.api_key' => 'creem_test_x']);
    expect(Creem::problems()[0])->toContain('test key');
    config(['fitpal.creem.api_base' => Creem::TEST_BASE]);
    expect(Creem::problems())->toBe([]);
});
