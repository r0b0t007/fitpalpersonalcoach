<?php

namespace App\Http\Controllers;

use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A coach's page as the public meets it (CHW-330, spec §3.1). No session: anyone with the link.
 *
 *  - /c/{handle} is the link in the bio (rewritten to /api/c/… by the docroot .htaccess). It is a
 *    page of preview tags for Instagram's and WhatsApp's crawlers, which read server HTML only,
 *    and a redirect into the app's #/c/<handle> — everything a person sees is the app's, in their
 *    language. With ?join=1, into the join form instead (#/join/<handle>): the way the app sends
 *    someone on from Instagram's browser to Safari or Chrome mid-form (CHW-332), as the link that
 *    leaves it (an Android intent) cannot carry a #/ route.
 *  - /public/coach is what that screen reads.
 *
 * A page shows while it is open and its coach is still an enabled coach.
 */
final class PublicPageController
{
    public function json(Request $request): JsonResponse
    {
        [$page, $coach] = CoachPage::findPublic(Handle::normalise($request->query('h')));
        if ($page === null || $coach === null) {
            return Json::error(404, 'no such coach page');
        }
        if (! $page->open) {
            return Json::error(404, 'this coach is not taking requests right now');
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
            'image' => rtrim((string) config('fitpal.origin'), '/').'/icon-512.png',
            'app' => ($request->query('join') === '1' ? '/#/join/' : '/#/c/').$handle,
        ], $shown ? 200 : 404)->header('Content-Type', 'text/html; charset=UTF-8');
    }
}
