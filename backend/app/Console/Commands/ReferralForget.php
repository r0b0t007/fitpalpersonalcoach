<?php

namespace App\Console\Commands;

use App\Coaching\Referrals;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * An objection, run by the owner (App\Coaching\Referrals::forget): a coach's to being recorded as
 * referred (CHW-350), or a client's to the referral check on their training (CHW-372, the legal
 * notice), which stops it by forgetting who referred the client's coach.
 */
final class ReferralForget extends Command
{
    protected $signature = 'fitpal:referral-forget {email : the coach\'s address, or their client\'s}';

    protected $description = 'Forget who referred a coach: they are never credited for again, and the credit stops naming them';

    public function handle(): int
    {
        $email = mb_strtolower(trim((string) $this->argument('email')));
        $user = User::query()->where('email', $email)->orWhere('pending_email', $email)->first();
        if ($user === null) {
            $this->error('No account with that address.');

            return self::FAILURE;
        }
        $coach = $user->isCoach() ? $user : ($user->coach_id === null ? null : User::query()->find($user->coach_id));
        if ($coach === null) {
            $this->error('That account is not a coach and has no coach.');

            return self::FAILURE;
        }
        Referrals::forget($coach);
        $this->info($coach->is($user)
            ? 'Forgotten: no referrer is recorded for that coach any more.'
            : 'A client\'s objection: no referrer is recorded for their coach any more, so their training is no longer checked.');

        return self::SUCCESS;
    }
}
