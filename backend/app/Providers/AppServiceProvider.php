<?php

namespace App\Providers;

use App\Auth\TokenGuard;
use App\WebAuthn\CacheChallengeRepository;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
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

        // A job that fails for good (out of tries, or timed out) lands in failed_jobs, which
        // nobody reads; cron output is discarded. One error line per failure is what an operator
        // will see. (A worker that exits non-zero is logged by its schedule, routes/console.php.)
        Queue::failing(fn (JobFailed $event) => Log::error('queued job failed', [
            'job' => $event->job->resolveName(),
            'error' => $event->exception->getMessage(),
        ]));
    }
}
