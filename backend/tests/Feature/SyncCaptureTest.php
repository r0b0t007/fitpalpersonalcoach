<?php

// public/index.php captures through App\Http\Request, which leaves the JSON API's bodies undecoded
// (every route reads the body as sent, through App\Support\Input) and decodes the admin panel's.
// Laravel's test client builds requests through the base class, so these tests build them the way
// index.php does and send them through the HTTP kernel.

use App\Auth\SessionToken;
use App\Http\Request;
use App\Models\User;
use Illuminate\Contracts\Http\Kernel;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

beforeEach(fn () => config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'http://localhost:5173']));

function captured(string $method, string $uri, string $body, array $server = []): Request
{
    return Request::createFromBase(SymfonyRequest::create($uri, $method, [], [], [], ['CONTENT_TYPE' => 'application/json'] + $server, $body));
}

it('does not decode the sync body at capture, on either mount', function (string $uri) {
    $r = captured('PUT', $uri, '{"state":{"week":{}}}');
    expect($r->request->all())->toBe([])                       // nothing decoded eagerly
        ->and($r->getContent())->toBe('{"state":{"week":{}}}')  // the raw body intact
        ->and($r->input('state.week'))->toBe([]);               // and still readable on demand
})->with(['/api/data', '/data']);

it('decodes no API body at capture: every route reads it once, as sent, through Input', function () {
    foreach (['/api/register/options', '/register/options', '/api/coach/assign'] as $uri) {
        $r = captured('POST', $uri, '{"name":"  Bob  "}');
        expect($r->request->all())->toBe([])->and($r->getContent())->toBe('{"name":"  Bob  "}');
    }
});

it('decodes the admin panel\'s JSON as Laravel does: Filament and Livewire read input()', function () {
    foreach (['/admin-panel/users', '/api/admin-panel', '/livewire/update', '/api/livewire/update'] as $uri) {
        expect(captured('POST', $uri, '{"a":1}')->request->all())->toBe(['a' => 1]);
    }
});

it('leaves an API body to Input, past the global input cleaners', function () {
    config(['fitpal.rp_id' => 'localhost', 'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost', 'fitpal.invite_only' => false]);
    $r = app(Kernel::class)->handle(captured('POST', '/api/register/options', '{"name":"\u0085Bob"}'));
    // Not TrimStrings' answer (its \s takes U+0085), JS's: the name keeps its NEL.
    expect(json_decode($r->getContent(), true)['options']['user']['name'] ?? null)->toBe("\u{0085}Bob");
});

it('saves and reads back a sync captured this way, with {} kept as {}', function () {
    $user = User::query()->create(['id' => 'synccapture00000', 'name' => 'Sync']);
    $auth = ['HTTP_AUTHORIZATION' => 'Bearer '.SessionToken::make($user)];
    $kernel = app(Kernel::class);

    $put = $kernel->handle(captured('PUT', '/api/data', '{"state":{"week":{},"active":{"x":1},"_ts":5}}', $auth));
    expect($put->getStatusCode())->toBe(200)->and(json_decode($put->getContent(), true))->toBe(['ok' => true, 'ts' => 5]);

    $get = $kernel->handle(captured('GET', '/api/data', '', $auth));
    expect($get->getContent())->toBe('{"state":{"week":{},"_ts":5}}');
});
