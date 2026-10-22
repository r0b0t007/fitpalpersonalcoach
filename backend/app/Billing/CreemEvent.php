<?php

namespace App\Billing;

use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Models\Licence;
use App\Models\User;
use App\Tenancy\CoachLock;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * One Creem webhook event applied to a coach's licence (spec §6). Creem's envelope is
 * `{id, eventType, created_at (ms), object}`; `object` is the checkout for `checkout.completed`,
 * the subscription for `subscription.*`, and a refund or dispute for those two.
 *
 * Who it is for, in order: the metadata our checkout put on it (`userId`, carried onto the
 * subscription), then a licence row holding its subscription id, its customer id, its checkout
 * request id — the first of these that is a coach. Which row: the one holding its subscription
 * id, then its checkout id or request id, then the coach's one pending row for the product; never
 * a row that already holds another subscription; else a new row (a subscription of theirs we have
 * never seen). Several pending rows for the product and nothing to tell them apart: the event is
 * sent back for Creem to retry (RetryLater), by when `checkout.completed` will have said which.
 *
 * Where `licence_id` points afterwards: at the row this event made writable if the licence in force
 * does not write; away from the row in force when this event made it stop writing and another row
 * of theirs writes; never away from a manual grant. Two plans writing at once (a payment on a
 * granted coach, a second subscription) is audited `billing.conflict` for the owner to refund.
 *
 * Runs inside the webhook's transaction, the coach's row locked first (CoachLock), then licences.
 */
final class CreemEvent
{
    /** Creem's subscription statuses as a licence status; `scheduled_cancel` stays active, with a date. */
    private const FROM_CREEM = [
        'active' => 'active', 'trialing' => 'trialing', 'past_due' => 'past_due', 'unpaid' => 'unpaid',
        'paused' => 'paused', 'canceled' => 'canceled', 'expired' => 'expired', 'scheduled_cancel' => 'active',
    ];

    /** Only when the subscription carries no status we know: what the event type implies. */
    private const BY_TYPE = [
        'subscription.active' => 'active', 'subscription.paid' => 'active', 'subscription.trialing' => 'trialing',
        'subscription.past_due' => 'past_due', 'subscription.unpaid' => 'unpaid', 'subscription.paused' => 'paused',
        'subscription.expired' => 'expired', 'subscription.canceled' => 'canceled',
    ];

    /** @var list<array{string, ?User, ?string}> audit lines, written by the caller after the commit */
    public array $audits = [];

    public bool $stale = false;

    public function __construct(private readonly array $event) {}

    public function type(): string
    {
        return (string) $this->event['eventType'];
    }

    public function apply(): void
    {
        $o = (array) $this->event['object'];
        $sub = $this->subscription($o);
        $coach = $this->coach($o, $sub);
        if ($coach === null) {
            $this->audits[] = ['billing.orphan', null, $this->type()];

            return;
        }
        if (in_array($this->type(), ['refund.created', 'dispute.created'], true)) {
            $this->money($coach, $o);

            return;
        }
        if ($sub === null) {
            // A checkout without a subscription (a one-off order) or an event we do not use.
            $this->audits[] = ['billing.ignored', $coach, $this->type()];

            return;
        }

        $licence = $this->row($coach, $o, $sub);
        $at = CarbonImmutable::createFromTimestampMs((int) $this->event['created_at']);
        if ($licence->last_event_at !== null && $at->lt($licence->last_event_at)) {
            // Creem does not promise order; an older event is recorded (billing_events) and not applied.
            $this->stale = true;
            $this->audits[] = ['billing.stale', $coach, $this->type()];

            return;
        }

        $creemStatus = is_string($sub['status'] ?? null) ? $sub['status'] : null;
        $status = self::FROM_CREEM[$creemStatus] ?? self::BY_TYPE[$this->type()] ?? null;
        $end = self::date($sub['current_period_end_date'] ?? null);
        $fill = [
            'source' => 'creem',
            'creem_subscription_id' => self::str($sub['id'] ?? null) ?? $licence->creem_subscription_id,
            'creem_customer_id' => self::id($sub['customer'] ?? null) ?? self::id($o['customer'] ?? null) ?? $licence->creem_customer_id,
            'period_start' => self::date($sub['current_period_start_date'] ?? null) ?? $licence->period_start,
            'period_end' => $end ?? $licence->period_end,
            'last_event_id' => (string) $this->event['id'], 'last_event_at' => $at,
        ];
        if ($status !== null) {
            $fill['status'] = $status;
            // What the subscription says now, including that a cancellation was taken back: a
            // resumed subscription carries `canceled_at: null` and no scheduled end.
            if (array_key_exists('canceled_at', $sub)) {
                $fill['canceled_at'] = self::date($sub['canceled_at']);
            }
            $scheduled = $creemStatus === 'scheduled_cancel' || $this->type() === 'subscription.scheduled_cancel';
            $fill['cancel_at'] = $scheduled ? ($end ?? $licence->period_end) : null;
            if ($status === 'trialing') {
                $fill['trial_ends_at'] = $end ?? $licence->trial_ends_at;
            }
        }
        $product = self::id($sub['product'] ?? null) ?? self::id($o['product'] ?? null);
        if ($product !== null && $product !== $licence->creem_product_id) {
            $sold = Plans::fromProduct($product);
            if ($sold !== null) {
                $fill += ['plan' => $sold['plan'], 'period' => $sold['period']];
            } else {
                // Not on sale here (retired from CREEM_PRODUCTS): the plan is left as it was — a
                // paying coach is not cut off for the owner's configuration — and the owner is told,
                // once: the product is recorded, so the next renewal does not say it again.
                $this->audits[] = ['billing.unsold', $coach, $product];
            }
            $fill['creem_product_id'] = $product;
        }
        $licence->forceFill($fill)->save();
        $this->audits[] = ['billing.event', $coach, $this->type()];
        $this->point($coach, $licence);
    }

    /**
     * The subscription this event is about: the object itself, or the checkout's — expanded, or
     * only its id (then its status comes with the subscription's own events).
     */
    private function subscription(array $o): ?array
    {
        if (str_starts_with($this->type(), 'subscription.')) {
            return $o;
        }
        if ($this->type() !== 'checkout.completed') {
            return null;
        }
        if (is_array($o['subscription'] ?? null)) {
            return $o['subscription'];
        }
        $id = self::str($o['subscription'] ?? null);

        return $id !== null ? ['id' => $id, 'customer' => $o['customer'] ?? null, 'product' => $o['product'] ?? null] : null;
    }

    private function coach(array $o, ?array $sub): ?User
    {
        $find = fn (string $column, ?string $value) => $value === null ? null
            : Licence::query()->where($column, $value)->orderByDesc('created_at')->value('user_id');
        $candidates = [
            fn () => self::str(($o['metadata'] ?? [])['userId'] ?? null) ?? self::str(($sub['metadata'] ?? [])['userId'] ?? null),
            fn () => $find('creem_subscription_id', self::str($sub['id'] ?? null) ?? self::id($o['subscription'] ?? null)),
            fn () => $find('creem_customer_id', self::id($sub['customer'] ?? null) ?? self::id($o['customer'] ?? null)),
            fn () => $find('request_id', self::str($o['request_id'] ?? null)),
        ];
        // The first that names a coach: a metadata id since turned client, or a stale one, must not
        // hide the coach the subscription id points at.
        foreach ($candidates as $candidate) {
            $id = $candidate();
            if ($id !== null && User::query()->whereKey($id)->first()?->isCoach()) {
                $coach = CoachLock::take($id);
                if ($coach !== null && $coach->isCoach()) {
                    return $coach;
                }
            }
        }

        return null;
    }

    /** The licence row this subscription lives on, locked; a new one if none is theirs yet. */
    private function row(User $coach, array $o, array $sub): Licence
    {
        $subId = self::str($sub['id'] ?? null);
        // A row already carrying another subscription is that subscription's, never this one's.
        $mine = fn () => Licence::query()->where('user_id', $coach->id)
            ->where(fn ($q) => $subId === null ? $q->whereNull('creem_subscription_id')
                : $q->whereNull('creem_subscription_id')->orWhere('creem_subscription_id', $subId))
            ->lockForUpdate();
        $checkout = $this->type() === 'checkout.completed' ? self::str($o['id'] ?? null) : null;
        $request = self::str($o['request_id'] ?? null);
        $licence = ($subId !== null ? $mine()->where('creem_subscription_id', $subId)->first() : null)
            ?? ($checkout !== null ? $mine()->where('checkout_id', $checkout)->first() : null)
            ?? ($request !== null ? $mine()->where('request_id', $request)->first() : null);
        if ($licence !== null) {
            return $licence;
        }
        // A subscription event that beat its checkout.completed: the pending row for its product —
        // if there is only one; with several, only checkout.completed can say which was paid.
        $product = self::id($sub['product'] ?? null);
        if ($product !== null && $checkout === null) {
            $pending = $mine()->where('status', 'pending')->where('creem_product_id', $product)->limit(2)->get();
            if ($pending->count() > 1) {
                throw new RetryLater;
            }
            if ($pending->count() === 1) {
                return $pending->first();
            }
        }

        return (new Licence)->forceFill(['id' => Licence::newId(), 'user_id' => $coach->id, 'source' => 'creem', 'status' => 'pending']);
    }

    /** licence_id after the event (see the class comment). */
    private function point(User $coach, Licence $licence): void
    {
        $current = Entitlement::licenceOf($coach, 'update');
        if ($current?->id === $licence->id) {
            if (! Entitlement::writable($licence)) {
                // It stopped writing: another subscription of theirs that writes takes over.
                $other = Licence::query()->where('user_id', $coach->id)->where('source', 'creem')->whereKeyNot($licence->id)
                    ->orderByDesc('created_at')->lockForUpdate()->get()->first(fn (Licence $l) => Entitlement::writable($l));
                if ($other !== null) {
                    $coach->forceFill(['licence_id' => $other->id])->save();
                }
            }

            return;
        }
        if (! Entitlement::writable($licence)) {
            return;
        }
        if ($current !== null && Entitlement::writable($current)) {
            // Two plans at once: a payment on a granted coach, or a second subscription. The one in
            // force stays (a grant is never displaced); the owner decides what to refund.
            $this->audits[] = ['billing.conflict', $coach, $licence->id];

            return;
        }
        if ($current?->source === 'manual' && $current->status === 'manual') {
            return;   // a grant on a plan not sold here: still never displaced
        }
        $coach->forceFill(['licence_id' => $licence->id])->save();
    }

    /** A refund or a dispute: told to the owner; a dispute marks the subscription's own row. */
    private function money(User $coach, array $o): void
    {
        $type = $this->type() === 'refund.created' ? 'billing.refund' : 'billing.dispute';
        $this->audits[] = [$type, $coach, self::str($o['id'] ?? null)];
        $sub = self::id($o['subscription'] ?? null);
        if ($type === 'billing.dispute' && $sub !== null) {
            // Only the row this subscription lives on: a dispute over a one-off order, or one we
            // cannot place, marks nothing — never a grant or another subscription.
            Licence::query()->where('user_id', $coach->id)->where('creem_subscription_id', $sub)->lockForUpdate()->first()
                ?->forceFill(['disputed' => true])->save();
        }
    }

    private static function str(mixed $v): ?string
    {
        return is_string($v) && $v !== '' ? $v : null;
    }

    /** Creem sends a related object either expanded or as its id. */
    private static function id(mixed $v): ?string
    {
        return is_array($v) ? self::str($v['id'] ?? null) : self::str($v);
    }

    private static function date(mixed $v): ?CarbonInterface
    {
        if (! is_string($v) || $v === '') {
            return null;
        }
        try {
            return CarbonImmutable::parse($v)->utc();
        } catch (\Throwable) {
            return null;
        }
    }
}
