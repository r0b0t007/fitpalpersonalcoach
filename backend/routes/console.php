<?php

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

// The queue, drained from the scheduler: shared hosting has no supervisor, so a worker lives at
// most about one cron minute. Measured on the cPanel host in CHW-227 (docs/DEPLOY_COACH_SUBDOMAIN.md):
// cron fires every minute but 2-51 s late, a 55 s worker exits cleanly, and the next minute's
// worker picks up the rest.
//
// The bounds fit together: --max-time is only checked BETWEEN jobs, so a worker can live up to
// max-time + timeout = 105 s, which stays under the 2-minute overlap lock (a second worker never
// starts beside it) and each job's 50 s under the database queue's 90 s retry_after (a job is never
// handed out twice). --timeout is enforced because the CLI has pcntl. The lock is 2 minutes, NOT
// Laravel's default 24 h: if the host kills a worker its finish callback never runs, and a 24 h
// lock would silently hold every push and reminder until tomorrow.
//
// --queue is explicit: a job dispatched onto any queue not listed here is never run. Add the
// queue name here in the same change that first uses it.
Schedule::command('queue:work database --queue=default --max-time=55 --timeout=50 --sleep=1 --stop-when-empty')
    ->everyMinute()
    ->withoutOverlapping(2)
    ->runInBackground()
    // Cron output is discarded (cPanel would mail it every minute), so a failing worker must say
    // so somewhere an operator looks.
    ->onFailure(fn () => Log::error('queue worker exited with a failure; queued pushes and reminders are not being sent'));

// fitpal:remind and fitpal:prune join here in R3.
