<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\Handle;
use App\Media\Jpeg;
use App\Media\Paths;
use App\Media\Serve;
use App\Media\Sniff;
use App\Media\Upload;
use App\Models\CoachPage;
use App\Support\ClientSafe;
use App\Support\Js;
use App\Support\Json;
use App\Tenancy\CoachLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * A coach's page photo (CHW-356): their face on the public page and in its link preview. One per
 * coach, on their page's row, so a coach saves the page before adding one.
 *
 * The one photo here anyone can fetch, so what is stored is only the picture: the app sends a
 * square drawn on a canvas, and the server keeps it only as a JPEG it has rewritten without its
 * metadata (App\Media\Jpeg) — no GPS from a photo posted some other way. Public while the page
 * is open and its coach still coaches (CoachPage::findPublic): closed or detached, it is 404, the
 * file kept for when the page opens again. Removed, the file goes.
 */
final class CoachPhotoController
{
    /** On each side, in pixels: under it, a portrait blurs; over it, it is not a photo from the app. */
    private const MIN_EDGE = 200;

    private const MAX_EDGE = 5000;

    /** How long anyone may keep a copy: closing the page hides it from the next fetch after. */
    private const PUBLIC_CACHE = 'public, max-age=3600';

    public function upload(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        // Before the body, with the connection closed: no page, nowhere for it.
        if (CoachPage::query()->first() === null) {
            return Json::error(409, 'save your page first', [], Json::CLOSE);
        }
        $dir = Paths::coachDir($coach->id, create: true);
        // Streamed as every upload is, for its refusals (the cap, the sniff, a body cut off), then
        // read whole: a page photo is at most Upload::maxPagePhoto(), and is rewritten in memory.
        $up = Upload::stream($request, $dir, Upload::maxPagePhoto(), 'photo');
        $raw = @file_get_contents($up['tmp']);
        @unlink($up['tmp']);
        $clean = $up['meta']['ext'] === 'jpg' && is_string($raw) ? Jpeg::clean($raw) : null;
        if ($clean === null || min($clean['w'], $clean['h']) < self::MIN_EDGE || max($clean['w'], $clean['h']) > self::MAX_EDGE) {
            return Json::error(415, 'that photo could not be used — try another');
        }
        $file = Js::token(16).'.jpg';
        $stored = $dir.DIRECTORY_SEPARATOR.$file;
        if (@file_put_contents($stored, $clean['bytes'], LOCK_EX) !== strlen($clean['bytes'])) {
            @unlink($stored);

            return Json::error(500, 'could not store the file');
        }

        $old = null;
        try {
            $page = DB::transaction(function () use ($coach, $file, &$old): ?CoachPage {
                // The coach's row, locked, as a page save takes it: a detach under it, or a second
                // upload, waits; and the page is read again, as it may be gone.
                $me = CoachLock::take($coach->id);
                if (! $me || $me->disabled || ! $me->isCoach()) {
                    throw new ClientSafe(403, 'forbidden');
                }
                $page = CoachPage::query()->lockForUpdate()->first();
                if ($page === null) {
                    return null;
                }
                $old = $page->photo;
                $page->forceFill(['photo' => $file, 'updated' => Js::nowMs()])->save();

                return $page;
            });
        } catch (Throwable $e) {
            @unlink($stored);
            throw $e;
        }
        if ($page === null) {
            @unlink($stored);

            return Json::error(409, 'save your page first');
        }
        // The old file only now, after the row naming it moved on.
        self::unlink($coach->id, $old);
        Audit::record($request, 'coach.page.photo', ['user' => $coach, 'msg' => $page->handle]);

        return Json::ok(['page' => $page->toCoach(), 'url' => CoachPage::url($page->handle)]);
    }

    /** POST /api/coach/page/photo/remove → the page without it; the file goes. */
    public function remove(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $old = null;
        $page = DB::transaction(function () use ($coach, &$old): ?CoachPage {
            CoachLock::take($coach->id);   // the coach's row first, as every page write takes them
            $page = CoachPage::query()->lockForUpdate()->first();
            if ($page === null || $page->photo === null) {
                return $page;
            }
            $old = $page->photo;
            $page->forceFill(['photo' => null, 'updated' => Js::nowMs()])->save();

            return $page;
        });
        if ($page === null) {
            throw new ClientSafe(404, 'no such coach page');
        }
        if ($old !== null) {
            self::unlink($coach->id, $old);
            Audit::record($request, 'coach.page.photo.remove', ['user' => $coach, 'msg' => $page->handle]);
        }

        return Json::ok(['page' => $page->toCoach(), 'url' => CoachPage::url($page->handle)]);
    }

    /** GET /api/coach/page/photo: the coach's own, for the editor, whether or not the page is open. */
    public function own(Request $request): Response
    {
        $page = CoachPage::query()->first();
        if ($page === null || ! Sniff::safeFile($page->photo)) {
            return Json::error(404, 'not found');
        }

        return Serve::file($request, Paths::coachDir($page->coach_id).DIRECTORY_SEPARATOR.$page->photo, 'image/jpeg');
    }

    /** GET /api/public/coach/photo?h= — anyone's, for an open page of a coach who still coaches. */
    public function public(Request $request): Response
    {
        [$page, $coach] = CoachPage::findPublic(Handle::normalise($request->query('h')));
        if ($page === null || $coach === null || ! $page->open || ! Sniff::safeFile($page->photo)) {
            return Json::error(404, 'not found');
        }

        return Serve::file($request, Paths::coachDir($page->coach_id).DIRECTORY_SEPARATOR.$page->photo, 'image/jpeg', self::PUBLIC_CACHE);
    }

    private static function unlink(string $coachId, ?string $file): void
    {
        if ($file !== null && Sniff::safeFile($file)) {
            @unlink(Paths::coachDir($coachId).DIRECTORY_SEPARATOR.$file);
        }
    }
}
