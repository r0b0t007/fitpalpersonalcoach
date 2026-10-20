<?php

use App\Audit\Audit;
use App\Models\Assignment;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

// The queue, drained from the scheduler: shared hosting has no supervisor, so a worker lives at
// most about one cron minute. Measured on the cPanel host in CHW-227 (docs/DEPLOY_COACH_SUBDOMAIN.md):
// cron fires every minute but 2-51 s late, a 55 s worker exits cleanly, and the next minute's
// worker picks up the rest.
//
// The bounds fit together: --max-time is only checked BETWEEN jobs, so a worker lives up to
// max-time + timeout = 105 s, which stays under the 2-minute overlap lock (a second worker never
// starts beside it), and each job's 50 s stays under the database queue's 90 s retry_after (a job
// is never handed out twice). A job class may override --timeout with its own $timeout, so
// tests/Unit/QueueBoundsTest.php refuses any job above 50 s. --timeout is enforced because the
// CLI has pcntl. The lock is 2 minutes, NOT Laravel's default 24 h: if the host kills a worker its
// finish callback never runs, and a 24 h lock would hold every push and reminder until tomorrow.
//
// The connection and queue come from config/queue.php, the same values dispatch() uses, so a
// changed QUEUE_CONNECTION or DB_QUEUE cannot leave jobs on a queue nobody drains. A job sent with
// onQueue('other') still needs that name added here.
$connection = config('queue.default');
if ($connection !== 'sync') {
    $queue = config("queue.connections.{$connection}.queue", 'default');

    Schedule::command("queue:work {$connection} --queue={$queue} --max-time=55 --timeout=50 --tries=3 --backoff=30 --sleep=1 --stop-when-empty")
        ->everyMinute()
        ->withoutOverlapping(2)
        ->runInBackground()
        // Exit codes, not job failures (those are logged one by one: AppServiceProvider's
        // Queue::failing). A non-zero exit is a worker that could not start, or a job that hit
        // --timeout and took the worker down; the next minute's worker carries on either way.
        ->onFailure(fn () => Log::warning('queue worker exited non-zero: a job hit --timeout, or the worker could not start'));
}

// Audit retention (AUDIT_DAYS, AUDIT_MAX), hourly as the Node API compacted it: the read path
// already hides expired rows, this deletes them — and their IPs — on an idle instance too.
Schedule::call(fn () => Audit::prune())->hourly()->name('audit:prune')->withoutOverlapping(10);

// Assignment retention (api/domain.mjs pruneAssignments: 30 days pending or answered, never the
// program a member is on). Node pruned on every send; hourly here, so housekeeping holds no
// recipient's lock and cannot fail a send.
Schedule::call(fn () => Assignment::prune())->hourly()->name('assignments:prune')->withoutOverlapping(10);

// fitpal:remind and the rest of fitpal:prune join here in R3.
