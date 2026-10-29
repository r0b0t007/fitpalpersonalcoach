<?php

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

// The host runs cron, and so this scheduler, every 5 minutes: it rewrites a crontab's
// `* * * * *` to `0,5,10,…` (CHW-311, docs/DEPLOY_COACH_SUBDOMAIN.md). The everyMinute() events
// below run on each of those ticks; nothing here may assume a run every minute.
//
// The reminders (app/Console/Commands/Remind.php), BEFORE the worker below starts: schedule:run
// goes in order, and a worker started first would find the queue empty and exit before these
// pushes were queued — a whole tick late. In the foreground and short (it reads only the reminder
// columns); it looks back over the last two ticks' minutes, and what it sends is recorded, so no
// minute is missed and none is sent twice.
Schedule::command('fitpal:remind')->everyMinute()->withoutOverlapping(2);

// The queue, drained from the scheduler: shared hosting has no supervisor, so a worker lives about
// a minute per tick. Measured on the cPanel host in CHW-227 (docs/DEPLOY_COACH_SUBDOMAIN.md): a run
// starts 2-51 s late and a 55 s worker exits cleanly. With a tick every 5 minutes a push waits for
// the next one, up to about 5 minutes. A longer-lived worker would cover the gap but make this
// shared account (which also runs FIT'ONE) host a near-permanent process; it is not done
// (CHW-311). The rest timer, the one push that must be on time, drops what is late instead
// (RestTimerPush::LATE_SECONDS).
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
        // --timeout and took the worker down; the next tick's worker carries on either way.
        ->onFailure(fn () => Log::warning('queue worker exited non-zero: a job hit --timeout, or the worker could not start'));
}

// Housekeeping, hourly (app/Console/Commands/Prune.php): audit retention (AUDIT_DAYS, AUDIT_MAX —
// the read path already hides expired rows, this deletes them and their IPs on an idle instance
// too), assignments past 30 days (Node pruned on every send; hourly here, so it holds no
// recipient's lock and cannot fail a send), stale presence, expired cache rows, abandoned uploads
// and temp files. In the background: at the top of the hour, the most usual reminder time, the
// reminders must not wait behind it.
Schedule::command('fitpal:prune')->hourly()->withoutOverlapping(10)->runInBackground();

// A database dump every night (app/Console/Commands/BackupDb.php), the only copy of what was
// written since the last deploy: deploy-backend.yml dumps before each deploy, and nothing else
// did. Into storage/backups/nightly, so the deploy's own dumps keep their count and are never
// mixed with these. Two weeks kept, tens of KB each today — which also means a deleted account or
// a pruned audit row survives up to two weeks in these copies (docs/DEPLOY_COACH_SUBDOMAIN.md).
// 03:00 UTC is the middle of the night in Morocco; in the background, so the reminders due that
// minute do not wait. The command's own output (what it dumped, or why it could not) goes to
// logs/backup.log, since a background event's output is otherwise thrown away. -v because the cron
// line runs schedule:run -q, and -q puts SHELL_VERBOSITY=-1 in the environment every scheduled
// command inherits: without an explicit verbosity of its own the dump prints nothing, failures
// included, and the log stays empty (CHW-311). The failure message repeats the whole command: a
// hand run without --keep=14 would prune the folder to 5.
$nightly = 'fitpal:backup-db --into=nightly --keep=14 -v';
Schedule::command($nightly)
    ->dailyAt('03:00')
    ->withoutOverlapping(30)
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/backup.log'))
    ->onFailure(fn () => Log::error("the nightly database dump failed (the reason is in storage/logs/backup.log); retry it by hand with: php artisan $nightly"));
