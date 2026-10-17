<?php

use Illuminate\Support\Facades\Schedule;

// The queue, drained from the scheduler: shared hosting has no supervisor, so a worker lives at
// most one cron minute. Measured on the cPanel host in CHW-227 (docs/DEPLOY_COACH_SUBDOMAIN.md):
// cron fires every minute but 2-51 s late, a 55 s worker exits cleanly, and the next minute's
// worker picks up the rest. The overlap lock expires after 2 minutes, NOT Laravel's default 24 h:
// if the host kills a worker, its finish callback never runs, and a 24 h lock would silently stop
// every queued push and reminder until tomorrow.
Schedule::command('queue:work database --max-time=55 --sleep=1 --stop-when-empty')
    ->everyMinute()
    ->withoutOverlapping(2)
    ->runInBackground();

// fitpal:remind and fitpal:prune join here in R3.
