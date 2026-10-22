<?php

namespace App\Http\Controllers;

use App\Media\Paths;
use App\Media\RowNotWritten;
use App\Media\Serve;
use App\Media\Sniff;
use App\Media\Upload;
use App\Models\ProgressPhoto;
use App\Models\User;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use App\Tenancy\Access;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * A client's progress photos (api/server.js POST /api/media/photo, GET /api/media/photos,
 * GET|HEAD /api/media/photo) — the only private media. Their own table and their own route,
 * never a demo row: a demo is listed to the coach's clients, a photo to its owner and whoever
 * coaches them, and the two predicates must not sit one field apart.
 *
 * The slot is (d, pose): `d` is the check-in period the app filed it under (periodStart), the
 * natural key that joins a photo to its check-in, and a retake replaces the slot.
 */
final class PhotoController
{
    public function upload(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user('api');
        // `String(q.get('d') || '').trim()`, as every refusal before the body: with the connection closed.
        $d = Js::trim(Input::searchParam($request, 'd') ?? '');
        if (! Js::isRealDate($d)) {
            return Json::error(400, 'bad date', [], Json::CLOSE);
        }
        $pose = Js::trim(Input::searchParam($request, 'pose') ?? '');
        if (! in_array($pose, ProgressPhoto::POSES, true)) {
            return Json::error(400, 'bad pose', [], Json::CLOSE);
        }
        // A cheap refusal before the body, so an upload that cannot be kept is not carried across
        // the wire first. Not the check that binds: that one is under the lock, below.
        if ($error = self::capError($user->id, $d, $pose, 0)) {
            return Json::error(429, $error, [], Json::CLOSE); // relayed: capError's two sentences are Say::f templates
        }
        $dir = Paths::photoDir($user->id, create: true);
        $up = Upload::stream($request, $dir, Upload::maxPhoto(), 'photo');

        // Unguessable, never content-addressed: a photo's name must say nothing about who took it
        // or when, should this directory ever be reachable some other way — and content addressing
        // would make the same bytes from two people collide. base64url starts a name with '-' or
        // '_' 2 times in 64, which Sniff::safeFile takes.
        $file = Js::token(16).'.'.$up['meta']['ext'];
        $stored = $dir.DIRECTORY_SEPARATOR.$file;
        if (! @rename($up['tmp'], $stored)) {
            @unlink($up['tmp']);

            return Json::error(500, 'could not store the file');
        }

        $replaced = [];
        try {
            $result = DB::transaction(function () use ($user, $d, $pose, $file, $up, &$replaced): ProgressPhoto|JsonResponse {
                // The client's own row, locked: two uploads for different poses at once each count
                // the other, and neither replaces the other's slot. Judged again on it, too: an
                // account disabled or removed while the file streamed files nothing.
                $me = User::query()->whereKey($user->id)->lockForUpdate()->first();
                if (! $me || $me->disabled) {
                    return Json::error(401, 'not signed in');
                }
                // The caps again, with the real size: the first ask was a promise about the past.
                if ($error = self::capError($user->id, $d, $pose, $up['bytes'])) {
                    return Json::error(429, $error); // relayed: capError's two sentences are Say::f templates
                }
                $old = ProgressPhoto::query()->where('user_id', $user->id)->where('d', $d)->where('pose', $pose)->get();
                $replaced = $old->pluck('file')->all();
                try {
                    ProgressPhoto::query()->whereKey($old->modelKeys())->delete();

                    return tap((new ProgressPhoto)->forceFill([
                        'id' => Js::randomId(), 'user_id' => $user->id, 'd' => $d, 'pose' => $pose, 'file' => $file,
                        'bytes' => $up['bytes'], 'mime' => $up['meta']['mime'], 'created' => Js::isoNow(),
                    ]))->save();
                } catch (Throwable $e) {
                    throw new RowNotWritten($e);
                }
            });
        } catch (RowNotWritten $e) {
            @unlink($stored);
            Log::error('photo save failed', ['exception' => $e->getPrevious()]);

            return Json::error(507, 'could not record the upload — is the disk full?');
        } catch (Throwable $e) {
            @unlink($stored);
            throw $e;
        }
        if ($result instanceof JsonResponse) {
            @unlink($stored);

            return $result;
        }
        // The replaced file goes only now, after the row naming it is gone: the other order leaves
        // a row pointing at nothing whenever the write fails — a broken tile nobody can repair.
        foreach ($replaced as $old) {
            if ($old !== $file && Sniff::safeFile($old)) {
                @unlink($dir.DIRECTORY_SEPARATOR.$old);
            }
        }

        return Json::ok(['ok' => true, 'photo' => $result->toPublic()]);
    }

    /** The caller's own photos, so their check-in sheet can show which angles this period has. */
    public function index(Request $request): JsonResponse
    {
        return Json::ok(['photos' => ProgressPhoto::listed($request->user('api')->id)]);
    }

    /**
     * The bytes. Not theirs, no such member, no such photo: the same 403 with the same body, so a
     * coach holding one id cannot walk the space and learn who else trains here. `u` defaults to
     * the caller (`String(q.get('u') || user.id)`); the owner check comes first, because
     * canCoachMember is false for coaching yourself.
     */
    public function show(Request $request): Response
    {
        $viewer = $request->user('api');
        $ownerId = Js::or(Input::searchParam($request, 'u'), $viewer->id);
        $owner = User::query()->find($ownerId);
        $row = $owner && Access::canSeePhotos($viewer, $owner)
            ? ProgressPhoto::query()->where('user_id', $owner->id)->where('id', Input::searchParam($request, 'id'))->first()
            : null;
        if (! $row || ! Sniff::safeFile($row->file)) {
            return Json::error(403, 'forbidden');
        }

        return Serve::file($request, Paths::photoDir($owner->id).DIRECTORY_SEPARATOR.$row->file, $row->mime);
    }

    /**
     * api/server.js photoCapError: both caps, measured without the slot being written — a retake
     * replaces a file rather than adding one, so neither cap can stop someone correcting this
     * period's photo, only opening a new slot. Null when within both.
     */
    private static function capError(string $userId, string $d, string $pose, int $incoming): ?string
    {
        $rest = ProgressPhoto::query()->where('user_id', $userId)->where(fn ($q) => $q->where('d', '!=', $d)->orWhere('pose', '!=', $pose))
            ->selectRaw('count(*) as n, coalesce(sum(bytes), 0) as b')->toBase()->first();
        if ((int) $rest->n >= ProgressPhoto::MAX_COUNT) {
            return Say::f('that is {0} photos already stored', ProgressPhoto::MAX_COUNT);
        }
        if ((int) $rest->b + $incoming > ProgressPhoto::MAX_TOTAL) {
            return Say::f('that is {0} MB of photos already stored', Upload::mb(ProgressPhoto::MAX_TOTAL));
        }

        return null;
    }
}
