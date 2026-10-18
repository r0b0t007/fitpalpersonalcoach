<?php

// The scheduled worker (routes/console.php) is bounded so that it never outlives its 2-minute
// overlap lock and no job outlives the database queue's retry_after. A job class can override the
// worker's --timeout with its own $timeout, which would quietly break both: two workers at once,
// and the same push sent twice. These keep the numbers honest as jobs are added in R3.

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\File;

const WORKER_TIMEOUT = 50;
const WORKER_MAX_TIME = 55;
const OVERLAP_LOCK_SECONDS = 120;

it('keeps the worker inside its overlap lock and every job inside retry_after', function () {
    $schedule = file_get_contents(base_path('routes/console.php'));
    expect($schedule)->toContain('--timeout='.WORKER_TIMEOUT)
        ->toContain('--max-time='.WORKER_MAX_TIME)
        ->toContain('withoutOverlapping('.(OVERLAP_LOCK_SECONDS / 60).')')
        ->and(WORKER_MAX_TIME + WORKER_TIMEOUT)->toBeLessThan(OVERLAP_LOCK_SECONDS)
        ->and(WORKER_TIMEOUT)->toBeLessThan((int) config('queue.connections.database.retry_after'));
});

it('lets no job class raise its own timeout above the worker\'s', function () {
    $dir = app_path('Jobs');
    $jobs = is_dir($dir) ? File::allFiles($dir) : [];
    foreach ($jobs as $file) {
        $class = 'App\\Jobs\\'.str_replace(['/', '.php'], ['\\', ''], $file->getRelativePathname());
        if (! class_exists($class) || ! is_subclass_of($class, ShouldQueue::class)) {
            continue;
        }
        $timeout = (new ReflectionClass($class))->getDefaultProperties()['timeout'] ?? null;
        expect($timeout === null || $timeout <= WORKER_TIMEOUT)
            ->toBeTrue("{$class} declares \$timeout = {$timeout}, above the worker's ".WORKER_TIMEOUT.' s');
    }
    expect(true)->toBeTrue();   // no jobs yet is a pass, not a risky test
});
