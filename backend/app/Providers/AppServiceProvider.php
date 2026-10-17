<?php

namespace App\Providers;

use App\Auth\TokenGuard;
use App\WebAuthn\CacheChallengeRepository;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\ServiceProvider;
use Laragear\WebAuthn\Contracts\WebAuthnChallengeRepository;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // The passkey package reads its own config keys; they are fed from fitpal.* so one set
        // of environment variables (RP_ID, ORIGIN, RP_NAME) drives everything, as before.
        config([
            'webauthn.relying_party.id' => config('fitpal.rp_id'),
            'webauthn.relying_party.name' => config('fitpal.rp_name'),
            'webauthn.origins' => config('fitpal.origin'),
            'webauthn.challenge.timeout' => CacheChallengeRepository::TTL,
        ]);
        // Challenges live in the cache under a `cid` the app carries, not in a session.
        $this->app->bind(WebAuthnChallengeRepository::class, fn ($app) => new CacheChallengeRepository($app['cache.store'], $app['request']));
    }

    public function boot(): void
    {
        // The `api` guard: the signed session token, from the cookie or the Bearer header.
        Auth::viaRequest('fitpal-token', fn (Request $request) => TokenGuard::resolve($request));
    }
}
