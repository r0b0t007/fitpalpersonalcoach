<?php

namespace App\Http\Middleware;

use App\Support\Json;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Cross-site request forgery, without a token. The app never sends one, so Laravel's token check
 * is off for these routes and the rules the Node API applied stand in:
 *
 *  1. GET, HEAD and OPTIONS pass.
 *  2. The routes that carry their own credential in the body pass (a WebAuthn challenge id, a
 *     one-shot pairing code): they act on no existing session and must work from the mobile
 *     WebView, whose origin is never ORIGIN.
 *  3. A Bearer header passes: a browser never attaches one on its own, so there is no ambient
 *     authority for a hostile page to borrow.
 *  4. Sec-Fetch-Site, set by the browser itself and unforgeable, must be same-origin or none. A
 *     sibling subdomain reports same-site and is refused, which SameSite=Lax alone would miss.
 *  5. Without it: no Origin header means no browser sent this (curl, a webhook, a monitor) and
 *     passes; otherwise Origin must equal ORIGIN.
 */
final class CsrfOrigin
{
    /** Method + path, with the /api prefix the app sends. */
    public const EXEMPT = [
        'POST /api/register/options', 'POST /api/register/verify',
        'POST /api/login/options', 'POST /api/login/verify',
        'POST /api/pair/redeem',
        // A sign-in link is opened from a mail, often in another browser than the app's; the
        // request says nothing about an existing session either way.
        'POST /api/login/email', 'POST /api/login/link',
        // Not the billing webhook: Creem sends no Origin, so rule 5 passes it, and a page that
        // forges one is refused here before the route's HMAC check ever runs.
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if ($this->ok($request)) {
            return $next($request);
        }
        // A wrong ORIGIN in .env shows up only here, so say what was compared (as the Node API did).
        Log::warning('refused cross-origin', [
            'path' => $request->getMethod().' '.$request->getPathInfo(),
            'origin' => $request->headers->get('Origin'),
            'sec_fetch_site' => $request->headers->get('Sec-Fetch-Site'),
            'expected' => config('fitpal.origin'),
        ]);

        return Json::error(403, 'cross-origin request refused');
    }

    public static function ok(Request $request): bool
    {
        if (in_array($request->getMethod(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return true;
        }
        if (in_array($request->getMethod().' /api/'.ltrim(self::apiPath($request), '/'), self::EXEMPT, true)) {
            return true;
        }
        if (str_starts_with((string) $request->headers->get('Authorization'), 'Bearer ')) {
            return true;
        }
        $site = $request->headers->get('Sec-Fetch-Site');
        if ($site !== null && $site !== '') {
            return $site === 'same-origin' || $site === 'none';
        }
        $origin = $request->headers->get('Origin');
        if ($origin === null || $origin === '') {
            return true;
        }

        return rtrim($origin, '/') === rtrim((string) config('fitpal.origin'), '/');
    }

    /** The path without the /api prefix, whichever shape it arrived in (see routes/api.php). */
    public static function apiPath(Request $request): string
    {
        $path = '/'.ltrim($request->path(), '/');

        return str_starts_with($path, '/api/') ? substr($path, 4) : $path;
    }
}
