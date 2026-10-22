<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Upload routes answer every refusal with `Connection: close` — the sign-in and role checks too,
 * which run before the body is read (Node's `shut`). An upload is the one request whose body is
 * not bounded by readBody's 5 MB: without the close, a refused caller — not even signed in — goes
 * on sending up to the whole file into a connection that has already been answered.
 *
 * Outermost on the route, so it sees the answers of the auth and coach middleware inside it.
 */
final class CloseOnRefusal
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if ($response->getStatusCode() >= 400) {
            $response->headers->set('Connection', 'close');
        }

        return $response;
    }
}
