<?php

namespace App\Jobs;

use App\Coaching\MemberCard;
use App\Models\PushSubscription;
use App\Push\Messages;
use App\Push\Sender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * One push to one user, sent by the queue worker. The message is named, not written: it is worded
 * in the user's language, which lives in their state (megabytes of workouts), and reading that
 * belongs here, after the request that caused the push has answered — as Node read it after its
 * response. Sent once: a retry could deliver a message a slow push service had already taken.
 */
final class SendPush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    /**
     * @param  'assignment'|'day-reminder'|'checkin-reminder'  $kind  (the rest timer is RestTimerPush)
     * @param  list<mixed>  $args  what the message needs besides the language (a coach's name…)
     */
    public function __construct(public readonly string $userId, public readonly string $kind, public readonly array $args = []) {}

    public function handle(Sender $sender): void
    {
        // Nobody to tell: no state read, no request built.
        if (! PushSubscription::query()->where('user_id', $this->userId)->exists()) {
            return;
        }
        $lang = MemberCard::lang($this->userId);
        $sender->send($this->userId, match ($this->kind) {
            'assignment' => Messages::assignment($lang, (string) $this->args[0], (string) config('fitpal.rp_name')),
            'day-reminder' => Messages::dayReminder($lang, $this->args[0] ?? null),
            'checkin-reminder' => Messages::checkinReminder($lang),
        });
    }
}
