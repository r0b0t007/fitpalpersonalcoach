<?php

use App\Http\Controllers\AuditController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DataController;
use App\Http\Controllers\MetaController;
use App\Http\Middleware\RequireAdmin;
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

    Route::middleware('auth:api')->group(function (): void {
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/logout/all', [AuthController::class, 'logoutAll']);
        Route::get('/data', [DataController::class, 'show']);
        Route::put('/data', [DataController::class, 'store']);

        Route::middleware(RequireAdmin::class)->group(function (): void {
            Route::get('/admin/audit', [AuditController::class, 'index']);
            Route::post('/admin/audit/clear', [AuditController::class, 'clear']);
        });
    });
};

Route::prefix('api')->group($routes);
Route::group([], $routes);
