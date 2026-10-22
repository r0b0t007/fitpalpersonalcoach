<?php

namespace App\Domain;

use App\Models\Licence;
use App\Models\User;
use App\Support\Js;
use Carbon\CarbonInterface;

/**
 * What a coach may do under their licence (spec §6), decided in one place:
 *
 *  1. an admin runs the instance: unlimited, writable, never a tenant;
 *  2. billing off (no Creem configured, Plans::billingOn) → `unlicensed`, writable, unlimited —
 *     a self-hosted instance and the test suite are unaffected;
 *  3. no licence → cap 0, not writable;
 *  4. writable while trialing, active, past_due (Creem is still retrying), manual, and canceled
 *     until the period that was paid for ends;
 *  5. canTakeClient = writable and under the cap; overCap = more active clients than the cap
 *     (after a downgrade: still writable, but cannot add).
 *
 * One safety net beyond the spec: a Creem licence whose period ended more than GRACE_DAYS ago with
 * no event since is not writable, whatever its stored status — a webhook lost for good must not
 * leave a coach licensed for ever.
 *
 * `used` counts active clients (User::activeClientsOf): a disabled client frees a seat. A client
 * account is not limited by anything here — clients are unaffected by their coach's billing.
 */
final readonly class Entitlement
{
    /** How long past its period a Creem licence stays writable with no news from Creem (stale()). */
    public const GRACE_DAYS = 14;

    public function __construct(
        public string $status,
        public ?string $plan,
        /** null: unlimited */
        public ?int $cap,
        public int $used,
        public bool $canWrite,
        public bool $canTakeClient,
        public bool $overCap,
        public ?CarbonInterface $trialEndsAt = null,
        public ?CarbonInterface $periodEnd = null,
    ) {}

    public static function for(User $user): self
    {
        if (! $user->isCoach()) {
            return new self('client', null, null, 0, true, false, false);
        }
        $used = User::activeClientsOf($user)->count();
        if ($user->isAdmin()) {
            return new self('admin', null, null, $used, true, true, false);
        }
        if (! Plans::billingOn()) {
            return new self('unlicensed', null, null, $used, true, true, false);
        }
        $licence = self::licenceOf($user);
        if ($licence === null) {
            return new self('none', null, 0, $used, false, false, $used > 0);
        }
        // A plan this instance does not sell (a hand-edited row; grant refuses one) takes no client,
        // and is not reported as over a cap it does not have.
        $cap = Plans::cap($licence->plan);
        $canWrite = self::writable($licence);

        return new self($licence->status, $licence->plan, $cap ?? 0, $used, $canWrite, $canWrite && $used < ($cap ?? 0), $cap !== null && $used > $cap,
            $licence->trial_ends_at, $licence->period_end);
    }

    /**
     * for()->canWrite without counting the clients: RequireWriter asks it on every gated request,
     * each chunk of an upload included, and needs nothing else.
     */
    public static function canWrite(User $user): bool
    {
        if (! $user->isCoach() || $user->isAdmin() || ! Plans::billingOn()) {
            return true;
        }
        $licence = self::licenceOf($user);

        return $licence !== null && self::writable($licence);
    }

    /**
     * Why this coach takes no more clients, or null when they can — the one reading of it, for
     * the invite list's `reason` and for every refusal (CoachSeat, the mint): `at_cap` for a plan
     * with a cap that is reached; `read_only` for a licence that does not write, and for a plan
     * this instance does not sell, which has no cap to be "at" (refusing it as "full (0)" or
     * "allows 0 clients — upgrade" would be untrue).
     */
    public function seatRefusal(): ?string
    {
        if ($this->canTakeClient) {
            return null;
        }

        return $this->canWrite && $this->cap > 0 ? 'at_cap' : 'read_only';
    }

    /** The user's licence, if it is theirs: a licence_id pointing at someone else's row is none. */
    private static function licenceOf(User $user): ?Licence
    {
        $licence = $user->licence_id !== null ? Licence::query()->find($user->licence_id) : null;

        return $licence !== null && $licence->user_id === $user->id ? $licence : null;
    }

    /** Rule 4, and the stale net. */
    private static function writable(Licence $licence): bool
    {
        return (in_array($licence->status, Licence::WRITABLE, true) && ! self::stale($licence))
            || ($licence->status === 'canceled' && $licence->period_end !== null && $licence->period_end->isFuture());
    }

    /**
     * A Creem licence whose paid period ended more than GRACE_DAYS ago without a word from Creem:
     * a renewal moves period_end on (CHW-270), so this is a webhook lost for good — stop writing
     * rather than stay licensed for ever. Creem's own retries (past_due) end well inside the grace.
     * A manual licence has no period.
     */
    private static function stale(Licence $licence): bool
    {
        return $licence->source === 'creem' && $licence->period_end !== null
            && $licence->period_end->lt(now()->subDays(self::GRACE_DAYS));
    }

    /** As the app reads it (`billing/me`, the banners): dates as ISO strings, the cap null when unlimited. */
    public function toArray(): array
    {
        return [
            'status' => $this->status, 'plan' => $this->plan, 'cap' => $this->cap, 'used' => $this->used,
            'canWrite' => $this->canWrite, 'canTakeClient' => $this->canTakeClient, 'overCap' => $this->overCap,
            'trialEndsAt' => $this->trialEndsAt !== null ? Js::iso($this->trialEndsAt) : null,
            'periodEnd' => $this->periodEnd !== null ? Js::iso($this->periodEnd) : null,
        ];
    }
}
