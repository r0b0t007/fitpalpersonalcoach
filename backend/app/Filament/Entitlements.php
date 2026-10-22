<?php

namespace App\Filament;

use App\Domain\Entitlement;
use App\Models\User;

/**
 * Entitlement::for, once per account per request: a panel page shows a coach's plan, seats and
 * colour from several columns, and each would otherwise count the clients and read the licence
 * again.
 */
final class Entitlements
{
    /** @var array<string, Entitlement> */
    private static array $seen = [];

    private static ?object $request = null;

    public static function for(User $user): Entitlement
    {
        // A new request (a long-lived worker, the test suite) starts afresh.
        if (self::$request !== request()) {
            self::$request = request();
            self::$seen = [];
        }

        return self::$seen[$user->id] ??= Entitlement::for($user);
    }
}
