<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Nothing the API answers may be cached by the browser: /me, /data and the coach roster are
 * re-read on every open and poll. Media bytes set their own long-lived header after this ran,
 * and that header wins because it is set later.
 */
final class NoStore
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if (! $response->headers->has('Cache-Control') || str_contains((string) $response->headers->get('Cache-Control'), 'no-cache')) {
            $response->headers->set('Cache-Control', 'no-store');
        }

        return $response;
    }
}
