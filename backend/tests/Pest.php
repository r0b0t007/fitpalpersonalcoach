<?php

use App\Auth\SessionToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

pest()->extend(TestCase::class)->in('Unit');

/**
 * The Authorization header the paired app sends, for a session minted for $user. A test that set
 * no secret gets a fixed one: CI has no .env, so a test that leaned on a local SESSION_SECRET
 * passed on a laptop and failed there. A secret a test chose is left alone.
 */
function bearer(User $user): array
{
    if (! SessionToken::configured()) {
        config(['fitpal.session_secret' => str_repeat('ab', 32)]);
    }

    return ['Authorization' => 'Bearer '.SessionToken::make($user)];
}
