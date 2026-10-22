<?php

namespace App\Console\Commands;

use App\Audit\Audit;
use App\Media\Paths;
use App\Models\Assignment;
use App\Models\BillingEvent;
use App\Models\MediaUpload;
use App\Models\Presence;
use App\Support\Js;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * The housekeeping Node did on timers and on writes, hourly from the scheduler:
 *
 *  - the audit log past AUDIT_DAYS / AUDIT_MAX, and their IPs (Audit::prune);
 *  - assignments past their 30 days (Assignment::prune, as Node's pruneAssignments);
 *  - presence rows past the 70 s TTL (reads already ignore them; Node swept every 30 s);
 *  - expired rows of the database cache store (passkey challenges, pairing codes);
 *  - Creem webhook ids past the newest BillingEvent::KEEP;
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
        $idle = $now - MediaUpload::IDLE_MS;
        foreach (MediaUpload::acrossCoaches()->where('touched', '<', $idle)->get() as $u) { // across coaches: housekeeping, every coach's abandoned uploads
            // Still idle as it is deleted: a chunk that revived it in the meantime keeps it.
            if (MediaUpload::acrossCoaches()->whereKey($u->id)->where('touched', '<', $idle)->delete() === 1) { // across coaches: the row just read
                @unlink($u->partialPath());
                $uploads++;
            }
        }
        $cache = $this->expiredCache();
        // Webhook ids kept for idempotency: the newest BillingEvent::KEEP, far more than Creem redelivers.
        $events = 0;
        // Raw, not cast: a Carbon compares without its milliseconds, and the boundary row would stay.
        $oldest = BillingEvent::query()->toBase()->orderByDesc('at')->orderByDesc('id')->skip(BillingEvent::KEEP)->value('at');
        if ($oldest !== null) {
            $events = BillingEvent::query()->where('at', '<=', $oldest)->delete();
        }
        $files = $this->orphans($now);
        $this->info("pruned: {$audit} audit, {$offers} offers, {$presence} presence, {$uploads} uploads, {$files} temp files, {$cache} cache rows, {$events} billing events");

        return self::SUCCESS;
    }

    /**
     * Expired rows of the database cache store: passkey challenges a ceremony never came back for,
     * pairing codes nobody redeemed, rest timers. Laravel removes an expired row only when that
     * same key is read again, and an abandoned challenge's never is (Node swept them every minute).
     */
    private function expiredCache(): int
    {
        $store = (string) config('cache.default');
        if (config("cache.stores.{$store}.driver") !== 'database') {
            return 0;
        }
        $connection = DB::connection(config("cache.stores.{$store}.connection"));
        $n = $connection->table((string) (config("cache.stores.{$store}.table") ?: 'cache'))->where('expiration', '<=', time())->delete();
        $connection->table((string) (config("cache.stores.{$store}.lock_table") ?: 'cache_locks'))->where('expiration', '<=', time())->delete();

        return $n;
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
