<?php

namespace App\Console\Commands;

use App\Audit\Audit;
use App\Media\Paths;
use App\Models\Assignment;
use App\Models\MediaUpload;
use App\Models\Presence;
use App\Support\Js;
use Illuminate\Console\Command;

/**
 * The housekeeping Node did on timers and on writes, hourly from the scheduler:
 *
 *  - the audit log past AUDIT_DAYS / AUDIT_MAX, and their IPs (Audit::prune);
 *  - assignments past their 30 days (Assignment::prune, as Node's pruneAssignments);
 *  - presence rows past the 70 s TTL (reads already ignore them; Node swept every 30 s);
 *  - chunked uploads nobody has sent to for a day, with their partial files;
 *  - temp files no request is writing any more (`.up-*` under media/ex and each photo folder)
 *    older than a day: a request killed mid-upload (a worker past its limit, a host reboot)
 *    never reaches the unlink that would have removed its own.
 */
final class Prune extends Command
{
    protected $signature = 'fitpal:prune';

    protected $description = 'Delete what has expired: audit rows, old offers, presence, abandoned uploads';

    public function handle(): int
    {
        $now = Js::nowMs();
        $audit = Audit::prune();
        $offers = Assignment::prune($now);
        $presence = Presence::query()->where('updated_at', '<', $now - Presence::TTL_MS)->delete();
        $uploads = 0;
        MediaUpload::acrossCoaches()->where('touched', '<', $now - MediaUpload::IDLE_MS)->get() // across coaches: housekeeping, every coach's abandoned uploads
            ->each(function (MediaUpload $u) use (&$uploads): void {
                $u->discard();
                $uploads++;
            });
        $files = $this->orphans($now);
        $this->info("pruned: {$audit} audit, {$offers} offers, {$presence} presence, {$uploads} uploads, {$files} temp files");

        return self::SUCCESS;
    }

    /** Temp files older than a day that no open chunked upload names. */
    private function orphans(int $now): int
    {
        $root = Paths::root();
        $dirs = [$root.DIRECTORY_SEPARATOR.'ex', ...(glob($root.DIRECTORY_SEPARATOR.'photo'.DIRECTORY_SEPARATOR.'*', GLOB_ONLYDIR) ?: [])];
        $open = MediaUpload::acrossCoaches()->pluck('id')->map(fn (string $id) => '.up-'.$id)->flip(); // across coaches: a file is an orphan only if no coach's upload names it
        $cutoff = intdiv($now - MediaUpload::IDLE_MS, 1000);
        $removed = 0;
        foreach ($dirs as $dir) {
            foreach (glob($dir.DIRECTORY_SEPARATOR.'.up-*') ?: [] as $file) {
                if (! $open->has(basename($file)) && is_file($file) && (int) @filemtime($file) < $cutoff && @unlink($file)) {
                    $removed++;
                }
            }
        }

        return $removed;
    }
}
