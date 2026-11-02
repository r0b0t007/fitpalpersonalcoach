<?php

use App\Http\Controllers\ActivityController;
use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\AssignmentController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BillingController;
use App\Http\Controllers\ChunkUploadController;
use App\Http\Controllers\CoachNoteController;
use App\Http\Controllers\CoachPageController;
use App\Http\Controllers\CoachProgramController;
use App\Http\Controllers\CoachRequestController;
use App\Http\Controllers\CoachRosterController;
use App\Http\Controllers\CoachTermsController;
use App\Http\Controllers\CreemWebhookController;
use App\Http\Controllers\DataController;
use App\Http\Controllers\ExerciseMediaController;
use App\Http\Controllers\HealthConsentController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\JoinController;
use App\Http\Controllers\LoginLinkController;
use App\Http\Controllers\MetaController;
use App\Http\Controllers\PairController;
use App\Http\Controllers\PhotoController;
use App\Http\Controllers\PublicPageController;
use App\Http\Controllers\PushController;
use App\Http\Middleware\CloseOnRefusal;
use App\Http\Middleware\RequireAdmin;
use App\Http\Middleware\RequireCoach;
use App\Http\Middleware\RequireFreshAuth;
use App\Http\Middleware\RequireWriter;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| The API, registered twice
|--------------------------------------------------------------------------
|
| The app always calls `/api/...`. Locally (`php artisan serve`, the Vite proxy) that prefix
| reaches Laravel as-is. On the server the front controller is mounted AT /api, so Laravel's base
| path is `/api` and the same request arrives as `/...`. Both shapes are routed to the same
| handlers, which is what the Node API did when Passenger stripped the prefix. Routes carry no
| names, so the double registration cannot collide.
|
*/

$routes = static function (): void {
    Route::get('/health', [MetaController::class, 'health']);
    Route::get('/config', [MetaController::class, 'config']);

    // Passkeys. These four carry their own credential (a challenge id) and are CSRF-exempt.
    Route::post('/register/options', [AuthController::class, 'registerOptions']);
    Route::post('/register/verify', [AuthController::class, 'registerVerify']);
    Route::post('/login/options', [AuthController::class, 'loginOptions']);
    Route::post('/login/verify', [AuthController::class, 'loginVerify']);
    Route::post('/logout', [AuthController::class, 'logout']);
    // Sign-in by email (R4; clients too since CHW-331). No session: the address, then the link's token or the code.
    Route::post('/login/email', [LoginLinkController::class, 'request']);
    Route::post('/login/link', [LoginLinkController::class, 'redeem']);
    Route::post('/login/code', [LoginLinkController::class, 'code']);
    // The phone's side of pairing: no session, the code is the credential (CSRF-exempt).
    Route::post('/pair/redeem', [PairController::class, 'redeem']);
    // The invite landing screen, before the person has an account.
    Route::get('/invite', [InviteController::class, 'show']);
    // A coach's public page (CHW-330): the link in their bio (HTML, for the link preview), and the
    // card the app draws from it. Anyone with the link.
    Route::get('/c/{handle}', [PublicPageController::class, 'html']);
    Route::get('/public/coach', [PublicPageController::class, 'json']);
    // Asking to join a coach from that page (CHW-336): no session, no account until accepted.
    Route::post('/join/start', [JoinController::class, 'start']);
    Route::post('/join/verify', [JoinController::class, 'verify']);
    Route::post('/join/status', [JoinController::class, 'status']);
    Route::post('/join/claim', [JoinController::class, 'claim']);

    // A coach's exercise demo: the file is the body. Outside the groups below so CloseOnRefusal
    // wraps the sign-in, coach and licence checks too — their refusals must close the connection
    // as well.
    Route::post('/media/exercise', [ExerciseMediaController::class, 'upload'])
        ->middleware([CloseOnRefusal::class, 'auth:api', RequireCoach::class, RequireWriter::class]);
    // The same demo in chunks (Laravel only, advertised in /api/config): start, each chunk, finish.
    // A lapsed licence stops all three; cancelling only frees space, so it stays open.
    Route::middleware([CloseOnRefusal::class, 'auth:api', RequireCoach::class])->group(function (): void {
        Route::post('/media/exercise/upload', [ChunkUploadController::class, 'start'])->middleware(RequireWriter::class);
        Route::put('/media/exercise/upload', [ChunkUploadController::class, 'chunk'])->middleware(RequireWriter::class);
        Route::post('/media/exercise/upload/finish', [ChunkUploadController::class, 'finish'])->middleware(RequireWriter::class);
        Route::delete('/media/exercise/upload', [ChunkUploadController::class, 'cancel']);
    });
    // A client's progress photo, for themselves: the same raw-body upload, any signed-in account.
    Route::post('/media/photo', [PhotoController::class, 'upload'])
        ->middleware([CloseOnRefusal::class, 'auth:api']);

    // Creem's webhook (R4, Laravel only): no session, the HMAC signature is the credential.
    Route::post('/billing/webhook', [CreemWebhookController::class, 'handle']);

    // The key a browser subscribes with: asked before anyone signs in, as of Node.
    Route::get('/push/public-key', [PushController::class, 'publicKey']);

    Route::middleware('auth:api')->group(function (): void {
        Route::get('/me', [AuthController::class, 'me']);
        // A coached client's consent to their coach seeing their health data (CHW-360).
        Route::get('/me/health-consent', [HealthConsentController::class, 'show']);
        Route::post('/me/health-consent', [HealthConsentController::class, 'give']);
        Route::post('/me/health-consent/withdraw', [HealthConsentController::class, 'withdraw']);
        // Web Push: this browser subscribed or not, and a test push to every browser subscribed.
        Route::post('/push/subscribe', [PushController::class, 'subscribe']);
        Route::post('/push/unsubscribe', [PushController::class, 'unsubscribe']);
        Route::post('/push/test', [PushController::class, 'test']);
        Route::post('/push/rest-timer', [PushController::class, 'restTimer']);
        Route::post('/push/rest-timer/cancel', [PushController::class, 'cancelRestTimer']);
        // The live-workout heartbeat, and its "left" (a sendBeacon too).
        Route::post('/activity', [ActivityController::class, 'store']);
        Route::post('/pair/create', [PairController::class, 'create']);
        Route::post('/logout/all', [AuthController::class, 'logoutAll']);
        // The caller's own sign-in address and whether it is confirmed (R4, Laravel only; the
        // Account email row) — kept out of /api/me, whose shape both APIs share.
        Route::get('/account', [LoginLinkController::class, 'account']);
        // A new sign-in address needs a recent sign-in too — judged in the controller, because
        // sending the link again to the address ALREADY pending changes nothing and does not.
        Route::post('/account/email', [LoginLinkController::class, 'changeEmail']);
        // Another passkey for this account (R4, Laravel only): a write that outlives the session,
        // so it needs one that signed in just now (RequireFreshAuth).
        Route::middleware(RequireFreshAuth::class)->group(function (): void {
            Route::post('/passkeys/options', [AuthController::class, 'passkeyOptions']);
            Route::post('/passkeys/verify', [AuthController::class, 'passkeyVerify']);
        });
        Route::get('/data', [DataController::class, 'show']);
        Route::put('/data', [DataController::class, 'store']);
        Route::post('/invite/redeem', [InviteController::class, 'redeem']);
        // Demo media: listed and served to whoever may see each row (ExerciseMedia::visibleTo).
        Route::get('/media/exercises', [ExerciseMediaController::class, 'index']);
        Route::get('/media/ex', [ExerciseMediaController::class, 'show']);
        // Progress photos: the caller's own list; the bytes to the owner and whoever coaches them.
        Route::get('/media/photos', [PhotoController::class, 'index']);
        Route::get('/media/photo', [PhotoController::class, 'show']);
        // A client's offers, from whichever coach sent them.
        Route::get('/assignments', [AssignmentController::class, 'inbox']);
        Route::get('/assignments/history', [AssignmentController::class, 'history']);
        Route::post('/assignments/decide', [AssignmentController::class, 'decide']);
        // A coach's replies and comments, as the client reads them (CHW-340).
        Route::get('/notes', [CoachNoteController::class, 'index']);
        Route::post('/notes/read', [CoachNoteController::class, 'read']);

        // Coach routes act as the coach (CoachContext): every tenant-owned model is scoped to them.
        // RequireWriter marks the writes a lapsed licence stops (spec §6); the rest stay open.
        Route::middleware(RequireCoach::class)->group(function (): void {
            // The coach terms and processor agreement (CHW-357).
            Route::get('/coach/terms', [CoachTermsController::class, 'show']);
            Route::post('/coach/terms', [CoachTermsController::class, 'accept']);
            Route::get('/coach/members', [CoachRosterController::class, 'members']);
            Route::get('/coach/member', [CoachRosterController::class, 'member']);
            Route::post('/coach/member/release', [CoachRosterController::class, 'release']);
            Route::get('/coach/invites', [InviteController::class, 'coachIndex']);
            Route::post('/coach/invites/new', [InviteController::class, 'coachCreate'])->middleware(RequireWriter::class);
            Route::post('/coach/invites/revoke', [InviteController::class, 'coachRevoke']);
            Route::get('/coach/programs', [CoachProgramController::class, 'index']);
            Route::post('/coach/programs/save', [CoachProgramController::class, 'save'])->middleware(RequireWriter::class);
            Route::post('/coach/programs/delete', [CoachProgramController::class, 'delete']);
            // The coach's public page (CHW-330): the link in their Instagram bio.
            Route::get('/coach/page', [CoachPageController::class, 'show']);
            Route::post('/coach/page/save', [CoachPageController::class, 'save'])->middleware(RequireWriter::class);
            Route::post('/coach/notes', [CoachNoteController::class, 'create'])->middleware(RequireWriter::class);
            // The followers who asked to join from that page (CHW-337).
            Route::get('/coach/requests', [CoachRequestController::class, 'index']);
            Route::get('/coach/requests/count', [CoachRequestController::class, 'count']);
            Route::post('/coach/requests/forget', [CoachRequestController::class, 'forget']);
            Route::post('/coach/requests/decide', [CoachRequestController::class, 'decide'])->middleware(RequireWriter::class);
            Route::post('/coach/assign', [AssignmentController::class, 'assign'])->middleware(RequireWriter::class);
            Route::post('/coach/assignments/withdraw', [AssignmentController::class, 'withdraw']);
            // Paying for the plan (R4, Laravel only). Not RequireWriter: a lapsed coach must pay.
            Route::post('/billing/checkout', [BillingController::class, 'checkout']);
            Route::get('/billing/me', [BillingController::class, 'me']);
            Route::post('/billing/portal', [BillingController::class, 'portal']);
        });

        Route::middleware(RequireAdmin::class)->group(function (): void {
            Route::get('/admin/audit', [AuditController::class, 'index']);
            Route::post('/admin/audit/clear', [AuditController::class, 'clear']);
            Route::get('/admin/invites', [InviteController::class, 'adminIndex']);
            Route::post('/admin/invites/new', [InviteController::class, 'adminCreate']);
            Route::post('/admin/invites/revoke', [InviteController::class, 'adminRevoke']);
            Route::get('/admin/users', [AdminUserController::class, 'index']);
            Route::get('/admin/user', [AdminUserController::class, 'show']);
            Route::post('/admin/user/disable', [AdminUserController::class, 'disable']);
            Route::post('/admin/user/coach', [AdminUserController::class, 'coach']);
            Route::post('/admin/user/assign-coach', [AdminUserController::class, 'assignCoach']);
            // A licence by hand (R4, Laravel only): no Creem, writable until revoked.
            Route::post('/admin/licence/grant', [AdminUserController::class, 'grant']);
            Route::post('/admin/licence/revoke', [AdminUserController::class, 'revoke']);
        });
    });
};

Route::prefix('api')->group($routes);
Route::group([], $routes);
