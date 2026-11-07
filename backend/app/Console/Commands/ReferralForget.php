<?php

namespace App\Console\Commands;

use App\Coaching\Referrals;
use App\Models\User;
use Illuminate\Console\Command;

/** An objection to being recorded as referred (CHW-350, App\Coaching\Referrals::forget): run by the owner. */
final class ReferralForget extends Command
{
    protected $signature = 'fitpal:referral-forget {email : the coach\'s address}';

    protected $description = 'Forget who referred a coach: they are never credited for again, and the credit stops naming them';

    public function handle(): int
    {
        $email = mb_strtolower(trim((string) $this->argument('email')));
        $coach = User::query()->where('email', $email)->orWhere('pending_email', $email)->first();
        if ($coach === null) {
            $this->error('No account with that address.');

            return self::FAILURE;
        }
        Referrals::forget($coach);
        $this->info('Forgotten: no referrer is recorded for that coach any more.');

        return self::SUCCESS;
    }
}
