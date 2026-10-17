<?php

use App\Http\Controllers\MetaController;
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
};

Route::prefix('api')->group($routes);
Route::group([], $routes);
