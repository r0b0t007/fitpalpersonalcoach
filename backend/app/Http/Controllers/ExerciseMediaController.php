<?php

namespace App\Http\Controllers;

use App\Media\Paths;
use App\Media\RowNotWritten;
use App\Media\Serve;
use App\Media\Sniff;
use App\Media\Upload;
use App\Models\ExerciseMedia;
use App\Models\User;
use App\Support\ClientSafe;
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
        [$exId, $label] = self::target($request);
        if (self::atCap($exId)) {
            return self::capRefusal();
        }
        $dir = Paths::dir('ex');
        $up = Upload::stream($request, $dir, Upload::maxVideo(), 'video');

        return self::store($coach, $exId, $label, $dir, $up);
    }

    /**
     * An arrived demo — a streamed body (upload) or an assembled chunked one (ChunkUploadController)
     * — moved into place and recorded: the one path both take, so they cannot store differently.
     * $up is Upload::stream's shape: the temp file, its size, its SHA-256 and the sniff.
     *
     * @param  array{tmp: string, bytes: int, sha: string, meta: array{ext: string, mime: string, needsTranscode: bool}}  $up
     */
    public static function store(User $coach, string $exId, string $label, string $dir, array $up): JsonResponse
    {
        // Content-addressed on what arrived: the same file twice lands on the same name, and a
        // name can be cached for good because it cannot change meaning. A demo uploaded to the Node
        // API was named without its coach; the same bytes again replace that row too.
        $sha16 = substr($up['sha'], 0, 16);
        $file = "{$exId}-{$coach->id}-{$sha16}.{$up['meta']['ext']}";
        $legacy = "{$exId}-{$sha16}.{$up['meta']['ext']}";
        $stored = $dir.DIRECTORY_SEPARATOR.$file;
        $existed = false;
        $replacedLegacy = false;
        try {
            $row = DB::transaction(function () use ($coach, $exId, $label, $file, $legacy, $stored, $up, &$existed, &$replacedLegacy): ExerciseMedia|JsonResponse {
                // Judged again on the locked row, as every attach to a coach is (CoachLock): a role
                // revoked or an account disabled while the file streamed lands no row.
                $me = CoachLock::take($coach->id);
                if (! $me || $me->disabled) {
                    return Json::error(401, 'not signed in');
                }
                if (! $me->isCoach()) {
                    return Json::error(403, 'forbidden');
                }
                // Re-checked under the lock: the first check ran before the upload, and parallel
                // uploads all passed it against the same count.
                if (self::atCap($exId)) {
                    return self::capRefusal();
                }
                // Under the lock too: whether this name already belongs to a committed row decides
                // whether a failed write may remove it.
                $existed = is_file($stored);
                if (! @rename($up['tmp'], $stored)) {
                    return Json::error(500, 'could not store the file');
                }
                try {
                    // The same bytes again replace their row: one row and one file, with a fresh id.
                    $replacedLegacy = ExerciseMedia::query()->where('file', $legacy)->exists();
                    ExerciseMedia::query()->whereIn('file', [$file, $legacy])->delete();

                    return tap((new ExerciseMedia)->forceFill([
                        'id' => Js::randomId(), 'ex_id' => $exId, 'file' => $file, 'label' => $label,
                        'bytes' => $up['bytes'], 'mime' => $up['meta']['mime'],
                        // 'raw' is not broken: nothing has yet confirmed a browser can decode it.
                        'status' => $up['meta']['needsTranscode'] ? 'raw' : 'ready', 'created' => Js::isoNow(),
                    ]))->save();
                } catch (Throwable $e) {
                    throw new RowNotWritten($e);
                }
            });
        } catch (RowNotWritten $e) {
            // The file is in place and the row is not: unwind it, or it is an orphan nothing lists
            // and nothing can delete, on a quota-limited host — unless a committed row already
            // named it (the same bytes again), which still needs it. Node's 507 was for exactly
            // this failure, a write that did not happen; anything else is the ordinary 500.
            if (! $existed) {
                @unlink($stored);
            }
            Log::error('media save failed', ['exception' => $e->getPrevious()]);

            return Json::error(507, 'could not record the upload — is the disk full?');
        } finally {
            @unlink($up['tmp']);   // still there only if it never reached its place
        }
        if ($row instanceof JsonResponse) {
            return $row;
        }
        // The Node-era file the same bytes replaced — only when this coach's row for it was the
        // one replaced, and no row names it any more. A file of that name with no row here is
        // not this upload's to remove.
        $old = $dir.DIRECTORY_SEPARATOR.$legacy;
        if ($replacedLegacy && is_file($old) && ! ExerciseMedia::acrossCoaches()->where('file', $legacy)->exists()) { // across coaches: a file is freed only when no coach's row names it
            @unlink($old);
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

    /**
     * `?ex=&label=`: the exercise id (`String(q.get('ex') || '').trim()`, whitelisted, not escaped —
     * it becomes a file name) and the label (trimmed, cut at 40).
     *
     * @return array{string, string}
     *
     * @throws ClientSafe
     */
    public static function target(Request $request): array
    {
        $exId = Js::trim(Input::searchParam($request, 'ex') ?? '');
        if (! preg_match('/^[A-Za-z0-9_-]{1,40}$/D', $exId)) {
            throw new ClientSafe(400, 'bad exercise id', [], Json::CLOSE);
        }

        return [$exId, Js::slice(Js::trim(Input::searchParam($request, 'label') ?? ''), 40)];
    }

    public static function capRefusal(): JsonResponse
    {
        return Json::error(429, Say::f('that exercise already has {0} videos', ExerciseMedia::MAX_PER_EXERCISE), [], Json::CLOSE);
    }

    /** The uploading coach's demos for one exercise (CoachContext): at the cap? */
    public static function atCap(string $exId): bool
    {
        return ExerciseMedia::query()->where('ex_id', $exId)->count() >= ExerciseMedia::MAX_PER_EXERCISE;
    }
}
