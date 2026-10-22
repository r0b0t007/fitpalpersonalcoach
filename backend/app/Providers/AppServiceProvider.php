<?php

namespace App\Providers;

use App\Audit\Audit;
use App\Auth\TokenGuard;
use App\Coaching\AssignmentSent;
use App\Jobs\SendPush;
use App\Models\User;
use App\Tenancy\CoachContext;
use App\WebAuthn\CacheChallengeRepository;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Login;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\ServiceProvider;
use Laragear\WebAuthn\Contracts\WebAuthnChallengeRepository;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // The coach a request acts as (RequireCoach sets it): one per request, never shared.
        $this->app->scoped(CoachContext::class);

        // Challenges live in the cache under a `cid` the app carries, not in a session.
        $this->app->bind(WebAuthnChallengeRepository::class, fn ($app) => new CacheChallengeRepository($app['cache.store'], $app['request']));
    }

    public function boot(): void
    {
        // The admin panel's password sign-in, the only one there is (/admin-panel): each attempt
        // recorded, as every passkey sign-in is. The address typed on a failure is not: a log of
        // what strangers try is a liability.
        Event::listen(Login::class, function (Login $event) {
            if ($event->guard === 'web' && $event->user instanceof User) {
                $request = request();
                Audit::record($request, 'admin.panel.login', ['user' => $event->user]);
            }
        });
        Event::listen(Failed::class, function (Failed $event) {
            if ($event->guard === 'web') {
                $request = request();
                Audit::record($request, 'admin.panel.login.fail', ['ok' => false, 'user' => $event->user instanceof User ? $event->user : null]);
            }
        });

        // The `api` guard: the signed session token, from the cookie or the Bearer header.
        Auth::viaRequest('fitpal-token', fn (Request $request) => TokenGuard::resolve($request));

        // A mass assignment that names a column outside $fillable is a bug, not a no-op: the
        // import once lost every account's creation date this way, silently.
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());

        // A program sent: each member told, in their language, by the queue (Node pushed after its
        // response). Best-effort, as Node's was: a member without push sees it in the app.
        Event::listen(AssignmentSent::class, function (AssignmentSent $e): void {
            foreach ($e->memberIds as $id) {
                SendPush::dispatch($id, 'assignment', [$e->coach->name]);
            }
        });

        // A job that fails for good (out of tries, or timed out) lands in failed_jobs, which
        // nobody reads; cron output is discarded. One error line per failure is what an operator
        // will see. (A worker that exits non-zero is logged by its schedule, routes/console.php.)
        Queue::failing(fn (JobFailed $event) => Log::error('queued job failed', [
            'job' => $event->job->resolveName(),
            'error' => $event->exception->getMessage(),
        ]));
    }
}
