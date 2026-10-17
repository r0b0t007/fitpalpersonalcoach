<?php

namespace App\Providers;

use App\Auth\TokenGuard;
use App\WebAuthn\CacheChallengeRepository;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\ServiceProvider;
use Laragear\WebAuthn\Contracts\WebAuthnChallengeRepository;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Challenges live in the cache under a `cid` the app carries, not in a session.
        $this->app->bind(WebAuthnChallengeRepository::class, fn ($app) => new CacheChallengeRepository($app['cache.store'], $app['request']));
    }

    public function boot(): void
    {
        // The `api` guard: the signed session token, from the cookie or the Bearer header.
        Auth::viaRequest('fitpal-token', fn (Request $request) => TokenGuard::resolve($request));

        // A mass assignment that names a column outside $fillable is a bug, not a no-op: the
        // import once lost every account's creation date this way, silently.
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());
    }
}
