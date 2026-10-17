<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * CORS as the Node API did it. The only cross-origin caller is the paired mobile app's WebView
 * (https://localhost on Android), which authenticates with a Bearer header, never a cookie. So
 * the Origin is reflected and credentials are NEVER allowed: a hostile page cannot borrow the
 * cookie session, and the app's requests, which all preflight (Content-Type: application/json on
 * every call plus Authorization), get through. Preflights are answered before routing, for any
 * path, with the header set the app was built against.
 */
final class ReflectOrigin
{
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->headers->get('Origin');

        if ($request->isMethod('OPTIONS')) {
            $response = response('', 204, [
                'Access-Control-Allow-Methods' => 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
                'Access-Control-Allow-Headers' => 'Content-Type, Authorization, Range',
                'Access-Control-Expose-Headers' => 'Content-Range, Accept-Ranges, Content-Length',
                'Access-Control-Max-Age' => '86400',
            ]);
        } else {
            $response = $next($request);
        }

        if ($origin !== null && $origin !== '') {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Vary', 'Origin', false);
        }

        return $response;
    }
}
