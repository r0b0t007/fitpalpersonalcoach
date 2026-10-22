<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Json;
use Illuminate\Http\JsonResponse;

/** The two routes that need no account: the deploy health check and the sign-in screen's flags. */
final class MetaController
{
    public function health(): JsonResponse
    {
        // "ok":true is the string the deploy workflows and the docs' curl check look for.
        return Json::ok(['ok' => true, 'users' => User::query()->count()]);
    }

    public function config(): JsonResponse
    {
        return Json::ok([
            'invite_only' => (bool) config('fitpal.invite_only'),
            'allow_guest' => (bool) config('fitpal.allow_guest'),
            // The access-request queue was a gym feature with nobody left to answer it; the form
            // in the app only shows when this is true, so it never shows.
            'request_access' => false,
            'self_serve' => (bool) config('fitpal.self_serve_coach'),
            // A demo may be sent in chunks (ChunkUploadController), each this big at most. The Node
            // API sends no `upload`, and the app then sends the whole file as one request.
            'upload' => ['chunked' => true, 'chunk_mb' => ChunkUploadController::CHUNK_MB],
        ]);
    }
}
