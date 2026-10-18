<?php

use App\Auth\SessionToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

pest()->extend(TestCase::class)->in('Unit');

/** The Authorization header the paired app sends, for a session minted for $user. */
function bearer(User $user): array
{
    return ['Authorization' => 'Bearer '.SessionToken::make($user)];
}
