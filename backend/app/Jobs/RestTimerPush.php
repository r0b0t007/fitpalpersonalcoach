<?php

namespace App\Jobs;

use App\Push\Messages;
use App\Push\Sender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Cache;

/**
 * "Rest over": the push the app asks for when a rest timer starts, for the case the tab is
 * backgrounded and never gets to cancel it (api/server.js scheduleRestTimer). Node held one
 * setTimeout per user; here it is a delayed job, which the cron-driven worker runs up to about a
 * minute and a half late (accepted for R3), and a token in the cache stands for Node's "the one
 * timer this user has": a new timer or a cancel replaces it, and a job whose token is no longer the
 * current one ends without a word — nothing has to find and delete a queued job.
 */
final class RestTimerPush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    /** @param  string|null  $lang  the language when the timer started, as Node captured it */
    public function __construct(public readonly string $userId, public readonly string $token, public readonly ?string $lang) {}

    public static function key(string $userId): string
    {
        return 'rest-timer:'.$userId;
    }

    public function handle(Sender $sender): void
    {
        // Still this user's timer? Taken as it is checked: of two copies, one sends.
        $lock = Cache::lock(self::key($this->userId).':fire', 30);
        if (! $lock->get()) {
            return;
        }
        try {
            if (Cache::get(self::key($this->userId)) !== $this->token) {
                return;
            }
            Cache::forget(self::key($this->userId));
        } finally {
            $lock->release();
        }
        $sender->send($this->userId, Messages::restTimer($this->lang));
    }
}
