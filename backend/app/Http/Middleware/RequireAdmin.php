<?php

namespace App\Http\Middleware;

use App\Audit\Audit;
use App\Models\User;
use App\Support\Json;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * /api/admin/*: 401 `not signed in`, 403 `forbidden`, as the Node API's requireAdmin. Only the 403
 * is audited: a 401 is any unauthenticated bot poking the admin routes, and logging those would
 * bury the events an operator wants to see. Runs after `auth:api`, which answers the 401.
 */
final class RequireAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var User|null $user */
        $user = $request->user('api');
        // Inside auth:api (where routes/api.php mounts it) this never happens: the guard answers
        // the same 401 first. It stays so the middleware is correct on its own, not by placement.
        if ($user === null) {
            return Json::error(401, 'not signed in');
        }
        if (! $user->isAdmin()) {
            Audit::record($request, 'admin.denied', ['ok' => false, 'user' => $user]);

            return Json::error(403, 'forbidden');
        }

        return $next($request);
    }
}
