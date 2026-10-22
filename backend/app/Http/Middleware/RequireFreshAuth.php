<?php

namespace App\Http\Middleware;

use App\Auth\FreshAuth;
use App\Support\Json;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The writes that would outlive a stolen session — a new sign-in address, a new passkey — need a
 * session that signed in just now (FreshAuth). A route middleware, so the next such write is
 * marked where it is declared (routes/api.php) rather than remembered inside its controller.
 *
 * Inside auth:api: the session is already known good, this asks only how recent its proof is.
 */
final class RequireFreshAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! FreshAuth::check($request)) {
            return Json::error(403, 'sign in again to do this — it needs a recent sign-in');
        }

        return $next($request);
    }
}
