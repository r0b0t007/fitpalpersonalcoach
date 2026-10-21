<?php

use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\AssignmentController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CoachProgramController;
use App\Http\Controllers\CoachRosterController;
use App\Http\Controllers\DataController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\MetaController;
use App\Http\Controllers\PairController;
use App\Http\Middleware\RequireAdmin;
use App\Http\Middleware\RequireCoach;
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
    // The phone's side of pairing: no session, the code is the credential (CSRF-exempt).
    Route::post('/pair/redeem', [PairController::class, 'redeem']);
    // The invite landing screen, before the person has an account.
    Route::get('/invite', [InviteController::class, 'show']);

    Route::middleware('auth:api')->group(function (): void {
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/pair/create', [PairController::class, 'create']);
        Route::post('/logout/all', [AuthController::class, 'logoutAll']);
        Route::get('/data', [DataController::class, 'show']);
        Route::put('/data', [DataController::class, 'store']);
        Route::post('/invite/redeem', [InviteController::class, 'redeem']);
        // A client's offers, from whichever coach sent them.
        Route::get('/assignments', [AssignmentController::class, 'inbox']);
        Route::get('/assignments/history', [AssignmentController::class, 'history']);
        Route::post('/assignments/decide', [AssignmentController::class, 'decide']);

        // Coach routes act as the coach (CoachContext): every tenant-owned model is scoped to them.
        Route::middleware(RequireCoach::class)->group(function (): void {
            Route::get('/coach/members', [CoachRosterController::class, 'members']);
            Route::get('/coach/member', [CoachRosterController::class, 'member']);
            Route::post('/coach/member/release', [CoachRosterController::class, 'release']);
            Route::get('/coach/invites', [InviteController::class, 'coachIndex']);
            Route::post('/coach/invites/new', [InviteController::class, 'coachCreate']);
            Route::post('/coach/invites/revoke', [InviteController::class, 'coachRevoke']);
            Route::get('/coach/programs', [CoachProgramController::class, 'index']);
            Route::post('/coach/programs/save', [CoachProgramController::class, 'save']);
            Route::post('/coach/programs/delete', [CoachProgramController::class, 'delete']);
            Route::post('/coach/assign', [AssignmentController::class, 'assign']);
            Route::post('/coach/assignments/withdraw', [AssignmentController::class, 'withdraw']);
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
        });
    });
};

Route::prefix('api')->group($routes);
Route::group([], $routes);
