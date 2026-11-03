<?php

namespace App\Http\Controllers;

use App\Audit\ClientIp;
use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Models\CoachPageView;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\RateLimiter;

/**
 * A coach's page as the public meets it (CHW-330, spec §3.1). No session: anyone with the link.
 *
 *  - /c/{handle} is the link in the bio (rewritten to /api/c/… by the docroot .htaccess). It is a
 *    page of preview tags for Instagram's and WhatsApp's crawlers, which read server HTML only,
 *    and a redirect into the app's #/c/<handle> — everything a person sees is the app's, in their
 *    language. With ?join=1, into the join form instead (#/join/<handle>): the way the app sends
 *    someone on from Instagram's browser to Safari or Chrome mid-form (CHW-332), as the link that
 *    leaves it (an Android intent) cannot carry a #/ route.
 *  - /public/coach is what that screen reads, and /public/coach/photo the coach's photo on it
 *    (CoachPhotoController, CHW-356).
 *
 * A page shows while it is open and its coach is still an enabled coach.
 */
final class PublicPageController
{
    /** One view per person and page in this many seconds. */
    private const VIEW_EVERY = 1800;

    public function json(Request $request): JsonResponse
    {
        [$page, $coach] = CoachPage::findPublic(Handle::normalise($request->query('h')));
        if ($page === null || $coach === null) {
            return Json::error(404, 'no such coach page');
        }
        if (! $page->open) {
            return Json::error(404, 'this coach is not taking requests right now');
        }
        // A view, for the funnel (CHW-335), when the page screen asks (?view=1): the join form
        // reads this card too, and the preview crawlers read only /c/, so a view is a person. The
        // coach looking at their own page is not one, and a person is one per page each half
        // hour: a refresh, or a loop of them, is not a crowd. The key holds a hash, for that long.
        if ($request->query('view') === '1' && $request->user('api')?->id !== $coach->id) {
            $who = ClientIp::for($request, 'full') ?? (string) $request->ip();
            RateLimiter::attempt('page-view:'.hash('sha256', $who.'|'.$coach->id), 1,
                fn () => CoachPageView::hit($coach->id, now('UTC')->format('Y-m-d')), self::VIEW_EVERY);
        }

        return Json::ok(['coach' => $page->toPublic($coach)]);
    }

    public function html(Request $request, string $handle): Response
    {
        $handle = Handle::normalise($handle);
        [$page, $coach] = CoachPage::findPublic($handle);
        $shown = $page !== null && $coach !== null && $page->open;

        return response()->view('coach-page', [
            'page' => $shown ? $page : null,
            'name' => $coach?->name,
            'url' => CoachPage::url($handle),
            // The coach's photo when the page has one (CHW-356), else the app's icon.
            'image' => rtrim((string) config('fitpal.origin'), '/').($shown && $page->photo ? $page->photoUrl() : '/icon-512.png'),
            'app' => ($request->query('join') === '1' ? '/#/join/' : '/#/c/').$handle,
        ], $shown ? 200 : 404)->header('Content-Type', 'text/html; charset=UTF-8');
    }
}
