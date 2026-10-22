<?php

namespace Tests\Support;

use App\Models\Licence;
use App\Models\User;

/**
 * Billing for a test: Creem configured (phpunit.xml pins it off), and a licence put in force.
 */
final class Billing
{
    public const PRODUCTS = 'solo:month=prod_sm,solo:year=prod_sy,pro:month=prod_pm,pro:year=prod_py,studio:month=prod_tm,studio:year=prod_ty';

    public static function on(string $products = self::PRODUCTS): void
    {
        config(['fitpal.creem.api_key' => 'creem_test_key', 'fitpal.creem.webhook_secret' => 'whsec_test', 'fitpal.creem.products' => $products]);
    }

    /** A licence for $coach, put in force. */
    public static function licence(User $coach, array $fields): Licence
    {
        $l = tap((new Licence)->forceFill($fields + ['id' => Licence::newId(), 'user_id' => $coach->id, 'source' => 'creem']))->save();
        $coach->forceFill(['licence_id' => $l->id])->save();

        return $l;
    }
}
