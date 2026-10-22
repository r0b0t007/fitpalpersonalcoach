<?php

namespace App\Http\Controllers;

use App\Media\Paths;
use App\Media\Serve;
use App\Media\Sniff;
use App\Media\Upload;
use App\Models\ExerciseMedia;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use App\Tenancy\CoachLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * A coach's exercise demos (api/server.js POST /api/media/exercise, GET /api/media/exercises,
 * GET|HEAD /api/media/ex). The file is the whole body and its metadata rides in the query string:
 * one file and two scalars need no multipart parser.
 *
 * Two deliberate changes from Node (spec §5): a client sees their own coach's demos, not every
 * coach's (ExerciseMedia::visibleTo, the same rule for the list and the bytes); and the
 * six-per-exercise cap and the file name are the uploading coach's (`{ex}-{coach}-{sha16}.{ext}`),
 * so one coach's library can never fill or overwrite another's.
 */
final class ExerciseMediaController
{
    public function upload(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        // `String(q.get('ex') || '').trim()`. Whitelisted, not escaped: this becomes a file name.
        $exId = Js::trim(Input::searchParam($request, 'ex') ?? '');
        if (! preg_match('/^[A-Za-z0-9_-]{1,40}$/D', $exId)) {
            return Json::error(400, 'bad exercise id', [], Json::CLOSE);
        }
        $label = Js::slice(Js::trim(Input::searchParam($request, 'label') ?? ''), 40);
        if (self::atCap($exId)) {
            return Json::error(429, Say::f('that exercise already has {0} videos', ExerciseMedia::MAX_PER_EXERCISE), [], Json::CLOSE);
        }
        $dir = Paths::dir('ex');
        $up = Upload::stream($request, $dir, Upload::maxVideo(), 'video');

        // Content-addressed on what arrived: the same file twice lands on the same name, and a
        // name can be cached for good because it cannot change meaning.
        $file = "{$exId}-{$coach->id}-".substr($up['sha'], 0, 16).".{$up['meta']['ext']}";
        $stored = $dir.DIRECTORY_SEPARATOR.$file;
        $existed = is_file($stored);
        try {
            $row = DB::transaction(function () use ($coach, $exId, $label, $file, $stored, $up): ExerciseMedia|JsonResponse {
                // Re-checked under the coach's lock: the first check ran before the upload, and
                // parallel uploads all passed it against the same count.
                CoachLock::take($coach->id);
                if (self::atCap($exId)) {
                    @unlink($up['tmp']);

                    return Json::error(429, Say::f('that exercise already has {0} videos', ExerciseMedia::MAX_PER_EXERCISE));
                }
                if (! @rename($up['tmp'], $stored)) {
                    @unlink($up['tmp']);

                    return Json::error(500, 'could not store the file');
                }
                // The same bytes again replace their row: one row and one file, with a fresh id.
                ExerciseMedia::query()->where('file', $file)->delete();

                return tap((new ExerciseMedia)->forceFill([
                    'id' => Js::randomId(), 'ex_id' => $exId, 'file' => $file, 'label' => $label,
                    'bytes' => $up['bytes'], 'mime' => $up['meta']['mime'],
                    // 'raw' is not broken: nothing has yet confirmed a browser can decode it.
                    'status' => $up['meta']['needsTranscode'] ? 'raw' : 'ready', 'created' => Js::isoNow(),
                ]))->save();
            });
        } catch (Throwable $e) {
            // The file is in place and the row is not: unwind it, or it is an orphan nothing lists
            // and nothing can delete, on a quota-limited host — unless it is the file of a row
            // that already existed (the same bytes again), which still needs it.
            if (! $existed) {
                @unlink($stored);
            }
            @unlink($up['tmp']);
            Log::error('media save failed', ['exception' => $e]);

            return Json::error(507, 'could not record the upload — is the disk full?');
        }
        if ($row instanceof JsonResponse) {
            return $row;
        }

        return Json::ok(['ok' => true, 'media' => $row->toNode()]);
    }

    /** Every demo the caller may see — what the app needs to know which exercises have one. */
    public function index(Request $request): JsonResponse
    {
        $rows = ExerciseMedia::visibleTo($request->user('api'))->get();

        return Json::ok(['media' => $rows->map(fn (ExerciseMedia $m) => $m->toListed())->all()]);
    }

    /**
     * The bytes, addressed by row id: nothing a caller types becomes part of a path. A row they may
     * not see is the same 404 as one that does not exist, and so is a stored name Sniff::safeFile
     * will not open (a hand-edited row).
     */
    public function show(Request $request): Response
    {
        $id = Input::searchParam($request, 'id');
        $row = $id === null ? null : ExerciseMedia::visibleTo($request->user('api'))->whereKey($id)->first();
        if (! $row || ! Sniff::safeFile($row->file)) {
            return Json::error(404, 'not found');
        }

        return Serve::file($request, Paths::root().DIRECTORY_SEPARATOR.'ex'.DIRECTORY_SEPARATOR.$row->file, $row->mime);
    }

    /** The uploading coach's demos for one exercise (CoachContext): at the cap? */
    private static function atCap(string $exId): bool
    {
        return ExerciseMedia::query()->where('ex_id', $exId)->count() >= ExerciseMedia::MAX_PER_EXERCISE;
    }
}
