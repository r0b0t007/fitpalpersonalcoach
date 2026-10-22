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
 * A licence on a plan this instance does not sell (a hand-edited row: grant and the webhook only
 * write plans that exist) is cap 0 and not writable — failing closed, so every refusal it meets
 * says "read-only" truthfully — and is not reported as over a cap it does not have.
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
    /** How long past its period a Creem licence stays writable with no news from Creem (Licence::isStale). */
    public const GRACE_DAYS = Licence::GRACE_DAYS;

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

    /**
     * $lock: the client count and the licence are read with locking reads, for a caller that holds
     * the coach's row (CoachLock) and attaches a client or mints a code on the answer. A plain read
     * inside a transaction answers from its snapshot (MariaDB's REPEATABLE READ), and a join path
     * fixes that snapshot BEFORE it waits for the coach — InviteGate::redeemable's peek,
     * registration's user count — so a join that committed during the wait would go uncounted and
     * two joins could both take the last seat. A locking read sees the latest commit.
     */
    public static function for(User $user, bool $lock = false): self
    {
        $exempt = self::exempt($user);
        if ($exempt === 'client') {
            return new self('client', null, null, 0, true, false, false);
        }
        $clients = User::activeClientsOf($user);
        $used = ($lock ? $clients->sharedLock() : $clients)->count();
        if ($exempt !== null) {
            return new self($exempt, null, null, $used, true, true, false);
        }
        $licence = self::licenceOf($user, $lock ? 'share' : null);
        if ($licence === null) {
            return new self('none', null, 0, $used, false, false, $used > 0);
        }
        $cap = Plans::cap($licence->plan);
        $canWrite = self::writable($licence);

        return new self($licence->status, $licence->plan, $cap ?? 0, $used, $canWrite, $canWrite && $used < $cap, $cap !== null && $used > $cap,
            $licence->trial_ends_at, $licence->period_end);
    }

    /**
     * for()->canWrite without counting the clients: RequireWriter asks it on every gated request,
     * each chunk of an upload included, and needs nothing else. The same rules, from the same
     * helpers.
     */
    public static function canWrite(User $user): bool
    {
        if (self::exempt($user) !== null) {
            return true;
        }
        $licence = self::licenceOf($user);

        return $licence !== null && self::writable($licence);
    }

    /**
     * Why this coach takes no more clients, or null when they can — the one reading of it, for
     * the invite list's `reason` and for every refusal (CoachSeat, the mint): `read_only` for a
     * licence that does not write, `at_cap` for one that does but has every seat taken.
     */
    public function seatRefusal(): ?string
    {
        if ($this->canTakeClient) {
            return null;
        }

        return $this->canWrite ? 'at_cap' : 'read_only';
    }

    /** Who no licence limits, by rules 1 and 2 — and a client, whom none ever does. */
    private static function exempt(User $user): ?string
    {
        return match (true) {
            ! $user->isCoach() => 'client',
            $user->isAdmin() => 'admin',
            ! Plans::billingOn() => 'unlicensed',
            default => null,
        };
    }

    /**
     * The user's licence, if it is theirs: a licence_id pointing at someone else's row is none.
     * $lock: `share` for a reader under the coach's lock (for()), `update` for a writer of
     * licences (the admin grant and revoke, the webhook) — each takes the coach's row first and
     * then the licence's.
     */
    public static function licenceOf(User $user, ?string $lock = null): ?Licence
    {
        if ($user->licence_id === null) {
            return null;
        }
        $query = Licence::query()->whereKey($user->licence_id);
        $query = match ($lock) {
            'share' => $query->sharedLock(),
            'update' => $query->lockForUpdate(),
            null => $query,
            // A typo must not quietly read without the lock the caller is relying on.
            default => throw new \InvalidArgumentException("unknown lock mode: {$lock}"),
        };
        $licence = $query->first();

        return $licence !== null && $licence->user_id === $user->id ? $licence : null;
    }

    /** Rule 4, the stale net, and only on a plan this instance sells — for a licence already in hand. */
    public static function writable(Licence $licence): bool
    {
        return Plans::cap($licence->plan) !== null
            && ((in_array($licence->status, Licence::WRITABLE, true) && ! $licence->isStale())
                || ($licence->status === 'canceled' && $licence->period_end !== null && $licence->period_end->isFuture()));
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
