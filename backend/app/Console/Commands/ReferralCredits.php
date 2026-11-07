<?php

namespace App\Console\Commands;

use App\Coaching\Referrals;
use Illuminate\Console\Command;
use Illuminate\Http\Request;

/** Hourly (routes/console.php): banks the referral months that are due (CHW-350, App\Coaching\Referrals). */
final class ReferralCredits extends Command
{
    protected $signature = 'fitpal:referral-credits';

    protected $description = 'Bank a free month for each coach whose referred coach has activated';

    public function handle(): int
    {
        $n = Referrals::creditDue(Request::create('/fitpal:referral-credits'));
        $this->info("{$n} referral month(s) banked");

        return self::SUCCESS;
    }
}
