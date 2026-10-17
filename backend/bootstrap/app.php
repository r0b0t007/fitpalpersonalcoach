<?php

use App\Http\Middleware\CsrfOrigin;
use App\Http\Middleware\NoStore;
use App\Http\Middleware\ReflectOrigin;
use App\Support\ClientSafe;
use App\Support\Json;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Middleware\HandleCors;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        // routes/api.php adds the prefix itself, once with and once without (see the note there).
        apiPrefix: '',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // CORS and preflights come first and apply to ANY path, matched or not: a preflight for an
        // unknown route still gets its 204, as the Node dispatcher answered it before routing.
        // Laravel's own HandleCors would answer `*` from config/cors.php first, so it goes.
        $middleware->remove(HandleCors::class);
        $middleware->prepend(ReflectOrigin::class);
        // The rest of the JSON API's pipeline: no-store on every answer, then the forgery check.
        // No throttling, no sessions, no cookie encryption: the session is a signed token the app
        // sends itself.
        $middleware->group('api', [
            NoStore::class,
            CsrfOrigin::class,
            SubstituteBindings::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // This backend is an API; only the Filament panel renders HTML.
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => ! $request->is('admin-panel*', 'api/admin-panel*'));

        // A refusal the caller may read: the English sentence (and its template, if any).
        $exceptions->render(fn (ClientSafe $e) => Json::error($e->status, $e->getMessage(), $e->extra, $e->headers));
        $exceptions->render(fn (AuthenticationException $e) => Json::error(401, 'not signed in'));
        // Unknown path or method: the Node API looked routes up by "METHOD /path" and answered
        // 404 for both, before any other check.
        $exceptions->render(fn (NotFoundHttpException $e) => Json::error(404, 'not found'));
        $exceptions->render(fn (MethodNotAllowedHttpException $e) => Json::error(404, 'not found'));
        // Laravel's own framework-level refusals (abort(), the throttler's 429, maintenance's
        // 503, validation) keep their status in the envelope. Routes refuse through ClientSafe,
        // whose sentences the app translates; this is the net under anything that does not.
        $exceptions->render(fn (HttpExceptionInterface $e) => Json::error($e->getStatusCode(), $e->getMessage() !== '' ? $e->getMessage() : ($e->getStatusCode() >= 500 ? 'server error' : 'request refused'), [], $e->getHeaders()));
        $exceptions->render(fn (ValidationException $e) => Json::error(400, (string) collect($e->errors())->flatten()->first()));
        $exceptions->render(fn (HttpResponseException $e) => $e->getResponse());
        // Everything else is a bug; its message is for the log, not the browser.
        $exceptions->render(function (Throwable $e, Request $request) {
            if (config('app.debug') || ! $request->expectsJson() && $request->is('admin-panel*', 'api/admin-panel*')) {
                return null;
            }

            return Json::error(500, 'server error');
        });
    })->create();
