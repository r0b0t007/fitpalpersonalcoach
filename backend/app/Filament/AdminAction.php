<?php

namespace App\Filament;

use App\Models\User;
use App\Support\ClientSafe;
use Filament\Notifications\Notification;
use Illuminate\Http\Request;

/**
 * Runs one of the owner's writes (App\Admin\Accounts) from the panel: with the request and the
 * signed-in admin, as the API routes pass them, so the write and its audit event are the same
 * whichever way the owner acted. A refusal is shown as the API would have said it.
 */
final class AdminAction
{
    /** @param  callable(Request, User): mixed  $write */
    public static function run(callable $write, string $done): void
    {
        /** @var User $admin */
        $admin = auth('web')->user();
        try {
            $write(request(), $admin);
        } catch (ClientSafe $e) {
            Notification::make()->danger()->title($e->getMessage())->send();

            return;
        }
        Notification::make()->success()->title($done)->send();
    }
}
