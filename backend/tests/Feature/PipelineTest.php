<?php

// CORS, CSRF-by-origin and the error envelope: the three behaviours every later route inherits.

use App\Support\ClientSafe;
use App\Support\Say;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    config(['fitpal.origin' => 'https://coach.example']);
    // A state-changing route and a throwing route, registered for these tests only.
    Route::middleware('api')->group(function () {
        Route::post('/api/_probe', fn () => response()->json(['ok' => true]));
        Route::get('/api/_refuse', fn () => throw new ClientSafe(429, Say::f('that exercise already has {0} videos', 6), ['left' => 0], ['Connection' => 'close']));
        Route::get('/api/_boom', fn () => throw new RuntimeException('database password is hunter2'));
    });
});

it('reflects the caller origin and never allows credentials', function () {
    $r = $this->getJson('/api/health', ['Origin' => 'https://localhost']);
    $r->assertOk()
        ->assertHeader('Access-Control-Allow-Origin', 'https://localhost')
        ->assertHeader('Vary', 'Origin')
        ->assertHeaderMissing('Access-Control-Allow-Credentials');
    $this->getJson('/api/health')->assertHeaderMissing('Access-Control-Allow-Origin');
});

it('answers every preflight before routing, with the fixed header set', function () {
    $r = $this->call('OPTIONS', '/api/anything/at/all', server: ['HTTP_ORIGIN' => 'https://localhost']);
    $r->assertStatus(204)
        ->assertHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS')
        ->assertHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range')
        ->assertHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
        ->assertHeader('Access-Control-Max-Age', '86400')
        ->assertHeader('Access-Control-Allow-Origin', 'https://localhost');
    expect($r->getContent())->toBe('');
});

it('applies the forgery rules of the Node API', function (array $headers, int $status) {
    $this->postJson('/api/_probe', [], $headers)->assertStatus($status);
})->with([
    'same-origin page' => [['Sec-Fetch-Site' => 'same-origin'], 200],
    'direct navigation' => [['Sec-Fetch-Site' => 'none'], 200],
    'sibling subdomain' => [['Sec-Fetch-Site' => 'same-site', 'Origin' => 'https://coach.example'], 403],
    'hostile page' => [['Sec-Fetch-Site' => 'cross-site'], 403],
    'old browser, matching origin' => [['Origin' => 'https://coach.example'], 200],
    'old browser, matching origin with slash' => [['Origin' => 'https://coach.example/'], 200],
    'old browser, other origin' => [['Origin' => 'https://evil.example'], 403],
    'no browser at all (curl, webhook)' => [[], 200],
    'paired app with a bearer' => [['Origin' => 'https://localhost', 'Sec-Fetch-Site' => 'cross-site', 'Authorization' => 'Bearer x'], 200],
]);

it('names the refusal the app translates', function () {
    $this->postJson('/api/_probe', [], ['Sec-Fetch-Site' => 'cross-site'])
        ->assertStatus(403)->assertExactJson(['error' => 'cross-origin request refused']);
});

it('never applies the forgery rules to reads', function () {
    $this->getJson('/api/health', ['Sec-Fetch-Site' => 'cross-site'])->assertOk();
});

it('renders a ClientSafe refusal as the envelope, with its template and extra headers', function () {
    $r = $this->getJson('/api/_refuse');
    $r->assertStatus(429)
        ->assertHeader('Connection', 'close')
        ->assertExactJson([
            'error' => 'that exercise already has 6 videos',
            'left' => 0,
            'msg' => ['k' => 'that exercise already has {0} videos', 'v' => [6]],
        ]);
    // Byte-identical to JSON.stringify: no escaped slashes or Unicode.
    expect($r->getContent())->not->toContain('\\u')->not->toContain('\\/');
});

it('hides everything about an unexpected error', function () {
    config(['app.debug' => false]);
    $this->getJson('/api/_boom')->assertStatus(500)->assertExactJson(['error' => 'server error']);
});
