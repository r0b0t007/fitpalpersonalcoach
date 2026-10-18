<?php

// public/index.php captures through App\Http\Request, which leaves the state sync body undecoded.
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

it('decodes every other JSON request as Laravel does', function () {
    expect(captured('POST', '/api/login/options', '{"a":1}')->request->all())->toBe(['a' => 1])
        ->and(captured('GET', '/api/data', '')->request->all())->toBe([]);
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
