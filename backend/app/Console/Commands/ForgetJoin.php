<?php

namespace App\Console\Commands;

use App\Models\JoinRequest;
use App\Models\LoginLink;
use Illuminate\Console\Command;

/**
 * For the operator, when someone withdraws their consent by writing to contact@fitpal.ma (CHW-334,
 * the legal page's promise): every request that address made, to any coach, and what it said.
 * A coach can do the same for one of their own from the inbox (coach/requests/forget).
 */
final class ForgetJoin extends Command
{
    protected $signature = 'fitpal:forget-join {email : the address the requests were made with}';

    protected $description = 'Delete every join request an address made, with its answers';

    public function handle(): int
    {
        $email = LoginLink::normaliseEmail((string) $this->argument('email'));   // as the form stored it
        $gone = JoinRequest::acrossCoaches()->where('email', $email)->delete(); // across coaches: a withdrawal covers every coach the address wrote to
        $this->info("Deleted {$gone} join request(s) for that address.");

        return self::SUCCESS;
    }
}
