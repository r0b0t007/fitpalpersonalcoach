<?php

namespace App\Console\Commands;

use App\Auth\Bootstrap;
use App\Auth\SessionToken;
use Illuminate\Console\Command;

/**
 * The configuration mistakes the Node API printed at boot, as a command a deploy runs (and an
 * operator can run any time). PHP has no long-lived boot to print them at: a warning per request
 * would bury the log.
 */
final class CheckConfig extends Command
{
    protected $signature = 'fitpal:check-config';

    protected $description = 'Report configuration that will not behave as intended';

    public function handle(): int
    {
        $warnings = Bootstrap::warnings();
        if (strlen((string) config('fitpal.session_secret')) < SessionToken::MIN_SECRET_LENGTH) {
            $warnings[] = 'SESSION_SECRET is unset or shorter than '.SessionToken::MIN_SECRET_LENGTH.' characters — nobody can sign in. In production it is the contents of the old DATA_DIR/secret.';
        }
        foreach ($warnings as $w) {
            $this->warn($w);
        }
        if ($warnings === []) {
            $this->info('configuration ok');
        }

        return $warnings === [] ? self::SUCCESS : self::FAILURE;
    }
}
