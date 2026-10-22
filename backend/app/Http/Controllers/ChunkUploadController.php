<?php

namespace App\Http\Controllers;

use App\Media\Paths;
use App\Media\Sniff;
use App\Media\Upload;
use App\Models\MediaUpload;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * A coach's exercise demo, sent in chunks (CHW-259). Cloudflare refuses a body over 100 MB and
 * gives up on a request not sent and answered within about 100 s, so a large video on a slow
 * phone uplink cannot cross it as one request. This is Laravel's alone: /api/config advertises it
 * (`upload.chunked`), and the app uses it only then — against the Node API it sends the single
 * request it always did.
 *
 *   POST /api/media/exercise/upload?ex=&label=&size=   → {upload, chunk}
 *   PUT  /api/media/exercise/upload?id=&offset=        one chunk as the body → {ok, received}
 *   POST /api/media/exercise/upload/finish?id=         → {ok, media}, exactly as the one-shot upload
 *
 * The checks are the one-shot upload's, in its words, made as early as each can be: the id, the
 * cap and the size before a byte arrives, the sniff on the first chunk, everything again at the
 * finish, where the file is stored by the very same ExerciseMediaController::store.
 */
final class ChunkUploadController
{
    /** Each chunk's most: about 32 s at 1 Mbit/s, well inside Cloudflare's ~100 s. */
    public const CHUNK_MB = 4;

    public function start(Request $request): JsonResponse
    {
        [$exId, $label] = ExerciseMediaController::target($request);
        if (ExerciseMediaController::atCap($exId)) {
            return ExerciseMediaController::capRefusal();
        }
        $size = Input::searchParam($request, 'size');
        $size = is_string($size) && preg_match('/^\d{1,15}$/D', $size) ? (int) $size : 0;
        if ($size === 0) {
            return Json::error(400, 'empty upload');
        }
        if ($size > Upload::maxVideo()) {
            return Json::error(413, Say::f('file is larger than the {0} MB limit', Upload::mb(Upload::maxVideo())));
        }
        Paths::dir('ex');
        // A coach holds a few uploads at most; a new one past that drops the oldest, so abandoned
        // halves cannot pile up on the host's quota faster than the prune clears them.
        MediaUpload::query()->orderBy('touched')->get()->slice(0, max(0, MediaUpload::query()->count() - MediaUpload::MAX_OPEN + 1))
            ->each(fn (MediaUpload $u) => $u->discard());
        $now = Js::nowMs();
        $upload = tap((new MediaUpload)->forceFill([
            'id' => Js::randomId(), 'ex_id' => $exId, 'label' => $label, 'size' => $size,
            'received' => 0, 'created' => Js::isoNow(), 'touched' => $now,
        ]))->save();
        if (@file_put_contents($upload->partialPath(), '') === false) {
            $upload->delete();

            return Json::error(500, 'could not write the file');
        }

        return Json::ok(['upload' => $upload->id, 'chunk' => self::CHUNK_MB * 1048576]);
    }

    public function chunk(Request $request): JsonResponse
    {
        return DB::transaction(function () use ($request): JsonResponse {
            // Locked: two copies of one chunk (a retry racing its original) are written once.
            $upload = self::find($request, lock: true);
            if (! $upload) {
                return Json::error(404, 'not found', [], Json::CLOSE);
            }
            $offset = Input::searchParam($request, 'offset');
            // Only where the server is: a retry after a lost answer is told where to resume.
            if (! is_string($offset) || $offset !== (string) $upload->received) {
                return Json::error(409, 'the upload is out of step', ['received' => $upload->received], Json::CLOSE);
            }
            $max = min(self::CHUNK_MB * 1048576, $upload->size - $upload->received);
            $in = $request->getContent(true);
            $out = @fopen($upload->partialPath(), 'c+b');
            if (! is_resource($in) || $out === false) {
                return Json::error(500, 'could not write the file', [], Json::CLOSE);
            }
            ftruncate($out, $upload->received);
            fseek($out, $upload->received);
            // One byte past what may come: a body longer than its place in the file is refused.
            $n = stream_copy_to_stream($in, $out, $max + 1);
            fclose($out);
            if ($n === false) {
                return Json::error(500, 'could not write the file', [], Json::CLOSE);
            }
            if ($n > $max) {
                $this->truncate($upload);

                return Json::error(413, Say::f('file is larger than the {0} MB limit', Upload::mb(Upload::maxVideo())), [], Json::CLOSE);
            }
            if ($n === 0) {
                return Json::error(400, 'empty upload', [], Json::CLOSE);
            }
            $declared = $request->server('CONTENT_LENGTH');
            if (is_numeric($declared) && $n < (int) $declared) {
                $this->truncate($upload);

                return Json::error(400, 'upload interrupted', [], Json::CLOSE);
            }
            // The first bytes decide what this is, as they did for the one-shot upload: a photo
            // or junk is refused now, not after the whole file has crossed.
            if ($upload->received === 0 && $n >= Sniff::BYTES) {
                $judged = Sniff::validate((string) file_get_contents($upload->partialPath(), false, null, 0, Sniff::BYTES), 'video');
                if (isset($judged['error'])) {
                    $upload->discard();

                    return Json::error(415, $judged['error'], [], Json::CLOSE); // relayed: Sniff::validate's sentences, each pinned in tests/Unit/SniffTest
                }
            }
            $upload->forceFill(['received' => $upload->received + $n, 'touched' => Js::nowMs()])->save();

            return Json::ok(['ok' => true, 'received' => $upload->received]);
        });
    }

    public function finish(Request $request): JsonResponse
    {
        $upload = self::find($request);
        if (! $upload) {
            return Json::error(404, 'not found');
        }
        if ($upload->received !== $upload->size) {
            return Json::error(400, 'upload interrupted');
        }
        $path = $upload->partialPath();
        $meta = Sniff::validate((string) @file_get_contents($path, false, null, 0, Sniff::BYTES), 'video');
        if (isset($meta['error'])) {
            $upload->discard();

            return Json::error(415, $meta['error']); // relayed: Sniff::validate's sentences, each pinned in tests/Unit/SniffTest
        }
        $sha = @hash_file('sha256', $path);
        if ($sha === false) {
            $upload->discard();

            return Json::error(500, 'could not write the file');
        }
        [$exId, $label, $size] = [$upload->ex_id, $upload->label, $upload->size];
        // The session ends here whatever the store decides, and only once: of two finishes racing,
        // the one that does not remove the row stores nothing (store() owns the bytes now).
        if (MediaUpload::query()->whereKey($upload->id)->delete() === 0) {
            return Json::error(404, 'not found');
        }

        return ExerciseMediaController::store($request->user('api'), $exId, $label, Paths::dir('ex'),
            ['tmp' => $path, 'bytes' => $size, 'sha' => $sha, 'meta' => $meta]);
    }

    /** The caller's own session named by `?id=` (CoachContext: another coach's is not found). */
    private static function find(Request $request, bool $lock = false): ?MediaUpload
    {
        $id = Input::searchParam($request, 'id');
        if ($id === null) {
            return null;
        }
        $query = MediaUpload::query()->whereKey($id);

        return ($lock ? $query->lockForUpdate() : $query)->first();
    }

    /** Back to what was accepted before a refused chunk, so a retry starts clean. */
    private function truncate(MediaUpload $upload): void
    {
        $f = @fopen($upload->partialPath(), 'c+b');
        if ($f !== false) {
            ftruncate($f, $upload->received);
            fclose($f);
        }
    }
}
