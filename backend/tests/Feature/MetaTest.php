<?php

// The two routes that need no account, in both path shapes the app may arrive with.

it('answers the health check with the string the deploy looks for', function () {
    $this->getJson('/api/health')
        ->assertOk()
        ->assertExactJson(['ok' => true, 'users' => 0]);
    // Symfony writes "no-store, private"; browsers read both the same, and the app only needs the
    // response not to be cached.
    expect($this->getJson('/api/health')->headers->get('Cache-Control'))->toContain('no-store');
    expect($this->getJson('/api/health')->getContent())->toContain('"ok":true');
});

it('serves the same route without the /api prefix, as a prefix-stripping mount sends it', function () {
    $this->getJson('/health')->assertOk()->assertJson(['ok' => true]);
    $this->getJson('/config')->assertOk()->assertJsonStructure(['invite_only', 'allow_guest', 'request_access', 'self_serve']);
});

it('reports the sign-in flags and never offers access requests', function () {
    config(['fitpal.invite_only' => true, 'fitpal.allow_guest' => false, 'fitpal.self_serve_coach' => true, 'fitpal.free_cap' => 0]);
    $this->getJson('/api/config')->assertOk()->assertExactJson([
        'invite_only' => true, 'allow_guest' => false, 'request_access' => false, 'self_serve' => true,
        'upload' => ['chunked' => true, 'chunk_mb' => 4],
        'billing' => false, 'plans' => [], 'free_cap' => 0, 'login_email' => true,
    ]);
});

it('answers an unknown path or method with the 404 envelope', function () {
    $this->getJson('/api/nope')->assertStatus(404)->assertExactJson(['error' => 'not found']);
    $this->postJson('/api/health')->assertStatus(404)->assertExactJson(['error' => 'not found']);
});
