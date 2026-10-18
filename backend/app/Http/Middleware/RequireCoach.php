<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\Json;
use App\Tenancy\CoachContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * /api/coach/*: 401 `not signed in`, 403 `forbidden` (api/server.js requireCoach), then the
 * request acts as this coach — CoachContext — so every tenant-owned model is scoped to them for
 * the rest of it. An admin passes (admins coach implicitly) and is scoped to their own id too.
 */
final class RequireCoach
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var User|null $user */
        $user = $request->user('api');
        // Inside auth:api this never happens (the guard answers the 401 first); it stays so the
        // middleware is correct on its own.
        if ($user === null) {
            return Json::error(401, 'not signed in');
        }
        if (! $user->isCoach()) {
            return Json::error(403, 'forbidden');
        }
        // Resolved here, not injected: the context is per request, a middleware instance may not be.
        app(CoachContext::class)->set($user);

        return $next($request);
    }
}
