<?php

namespace App\Jobs;

use App\Coaching\MemberCard;
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
 * setTimeout per user; here it is a delayed job, and a token in the cache stands for Node's "the one
 * timer this user has": a new timer or a cancel replaces it, and a job whose token is no longer the
 * current one ends without a word — nothing has to find and delete a queued job.
 */
final class RestTimerPush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /**
     * How late past its due time the worker may run a job and it still sends: the token's cache
     * lifetime is the rest plus this, and a job that finds it gone stays silent.
     *
     * Short on purpose (CHW-311). The worker only runs when cron does, every 5 minutes on this host,
     * so most of these run minutes late — and "rest over" minutes after the rest ended buzzes in the
     * middle of the next set, which is worse than no push: the app's own timer is on screen anyway,
     * and the phone app schedules its own notification (lib/mobile.js). What is left on time is a
     * rest that ends just before a cron tick. On time for everyone needs the timer off this host.
     */
    public const LATE_SECONDS = 30;

    public int $tries = 1;

    public function __construct(public readonly string $userId, public readonly string $token) {}

    public static function key(string $userId): string
    {
        return 'rest-timer:'.$userId;
    }

    public function handle(Sender $sender): void
    {
        // Still this user's timer? Only compared, never cleared here: a clear could land after
        // the next rest had already put its own token, and silence that one instead.
        if (Cache::get(self::key($this->userId)) !== $this->token) {
            return;
        }
        // Once per timer, should the same job be handed out twice: `add` is atomic, and only the
        // first one in may send.
        if (! Cache::add(self::key($this->userId).':sent:'.$this->token, true, self::LATE_SECONDS)) {
            return;
        }
        $sender->send($this->userId, Messages::restTimer(MemberCard::lang($this->userId)));
    }
}
