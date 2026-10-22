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
 * request id. Which row: the one holding its subscription id, its checkout id or request id, then
 * the coach's pending row for the same product, else a new row.
 *
 * Where `licence_id` points afterwards: the row this event made writable, if the licence in force
 * does not write — but never away from a manual grant (a payment landing on a coach who holds one
 * is audited for the owner instead), and never by an event about a row other than the one in
 * force that leaves it unwritable.
 *
 * Runs inside the webhook's transaction, the coach's row locked first (CoachLock), then licences.
 */
final class CreemEvent
{
    /** What `subscription.*` says the status is now; `scheduled_cancel` stays active, with a date. */
    private const STATUS = [
        'subscription.active' => 'active', 'subscription.paid' => 'active', 'subscription.trialing' => 'trialing',
        'subscription.past_due' => 'past_due', 'subscription.unpaid' => 'unpaid', 'subscription.paused' => 'paused',
        'subscription.expired' => 'expired', 'subscription.canceled' => 'canceled',
    ];

    /** Creem's own subscription statuses, as a licence status (`checkout.completed`, `subscription.update`). */
    private const FROM_CREEM = [
        'active' => 'active', 'trialing' => 'trialing', 'past_due' => 'past_due', 'unpaid' => 'unpaid',
        'paused' => 'paused', 'canceled' => 'canceled', 'expired' => 'expired', 'scheduled_cancel' => 'active',
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

        $status = self::STATUS[$this->type()] ?? self::FROM_CREEM[(string) ($sub['status'] ?? '')] ?? null;
        $fill = [
            'source' => 'creem',
            'creem_subscription_id' => self::str($sub['id'] ?? null) ?? $licence->creem_subscription_id,
            'creem_customer_id' => self::id($sub['customer'] ?? null) ?? self::id($o['customer'] ?? null) ?? $licence->creem_customer_id,
            'period_start' => self::date($sub['current_period_start_date'] ?? null) ?? $licence->period_start,
            'period_end' => self::date($sub['current_period_end_date'] ?? null) ?? $licence->period_end,
            'canceled_at' => self::date($sub['canceled_at'] ?? null) ?? $licence->canceled_at,
            'last_event_id' => (string) $this->event['id'], 'last_event_at' => $at,
        ];
        if ($status !== null) {
            $fill['status'] = $status;
        }
        if (($status ?? $licence->status) === 'trialing') {
            $fill['trial_ends_at'] = self::date($sub['current_period_end_date'] ?? null) ?? $licence->trial_ends_at;
        }
        if ($this->type() === 'subscription.scheduled_cancel' || ($sub['status'] ?? null) === 'scheduled_cancel') {
            $fill['cancel_at'] = self::date($sub['current_period_end_date'] ?? null);
        }
        $product = self::id($sub['product'] ?? null) ?? self::id($o['product'] ?? null);
        if ($product !== null) {
            $sold = Plans::fromProduct($product);
            if ($sold !== null) {
                $fill += ['plan' => $sold['plan'], 'period' => $sold['period'], 'creem_product_id' => $product];
            } elseif ($product !== $licence->creem_product_id) {
                // Not on sale here (a product retired from CREEM_PRODUCTS): the plan is left as it was.
                $this->audits[] = ['billing.unsold', $coach, $product];
            }
        }
        $licence->forceFill($fill)->save();
        $this->audits[] = ['billing.event', $coach, $this->type()];
        $this->point($coach, $licence);
    }

    /** The subscription this event is about: the object itself, or the checkout's. */
    private function subscription(array $o): ?array
    {
        if (str_starts_with($this->type(), 'subscription.')) {
            return $o;
        }
        if ($this->type() === 'checkout.completed' && is_array($o['subscription'] ?? null)) {
            return $o['subscription'];
        }

        return null;
    }

    private function coach(array $o, ?array $sub): ?User
    {
        $userId = self::str(($o['metadata'] ?? [])['userId'] ?? null) ?? self::str(($sub['metadata'] ?? [])['userId'] ?? null);
        $find = fn (string $column, ?string $value) => $value === null ? null
            : Licence::query()->where($column, $value)->orderByDesc('created_at')->value('user_id');
        $id = $userId
            ?? $find('creem_subscription_id', self::str($sub['id'] ?? null) ?? self::id($o['subscription'] ?? null))
            ?? $find('creem_customer_id', self::id($sub['customer'] ?? null) ?? self::id($o['customer'] ?? null))
            ?? $find('request_id', self::str($o['request_id'] ?? null));
        if ($id === null) {
            return null;
        }
        $coach = CoachLock::take($id);

        return $coach !== null && $coach->isCoach() ? $coach : null;
    }

    /** The licence row this subscription lives on, locked; a new one if none is theirs yet. */
    private function row(User $coach, array $o, array $sub): Licence
    {
        $mine = fn () => Licence::query()->where('user_id', $coach->id)->lockForUpdate();
        $checkout = $this->type() === 'checkout.completed' ? self::str($o['id'] ?? null) : null;
        $product = self::id($sub['product'] ?? null);
        $licence = (($id = self::str($sub['id'] ?? null)) !== null ? $mine()->where('creem_subscription_id', $id)->first() : null)
            ?? ($checkout !== null ? $mine()->where('checkout_id', $checkout)->first() : null)
            ?? (($req = self::str($o['request_id'] ?? null)) !== null ? $mine()->where('request_id', $req)->first() : null)
            // A subscription event that beat its checkout.completed here: the pending row for its product.
            ?? ($product !== null ? $mine()->where('status', 'pending')->where('creem_product_id', $product)->orderByDesc('created_at')->first() : null);

        return $licence ?? (new Licence)->forceFill(['id' => Licence::newId(), 'user_id' => $coach->id, 'source' => 'creem', 'status' => 'pending']);
    }

    /** licence_id after the event (see the class comment). */
    private function point(User $coach, Licence $licence): void
    {
        if ($coach->licence_id === $licence->id) {
            return;
        }
        $current = Entitlement::licenceOf($coach, 'update');
        if ($current?->source === 'manual' && $current->status === 'manual') {
            if (Entitlement::writable($licence)) {
                $this->audits[] = ['billing.conflict', $coach, $licence->id];
            }

            return;
        }
        if (Entitlement::writable($licence) && ($current === null || ! Entitlement::writable($current))) {
            $coach->forceFill(['licence_id' => $licence->id])->save();
        }
    }

    /** A refund or a dispute: told to the owner; a dispute marks the licence. Nothing else changes. */
    private function money(User $coach, array $o): void
    {
        $type = $this->type() === 'refund.created' ? 'billing.refund' : 'billing.dispute';
        $this->audits[] = [$type, $coach, self::str($o['id'] ?? null)];
        if ($type === 'billing.dispute') {
            $sub = self::id($o['subscription'] ?? null);
            $licence = $sub !== null ? Licence::query()->where('user_id', $coach->id)->where('creem_subscription_id', $sub)->lockForUpdate()->first() : null;
            $licence ??= Entitlement::licenceOf($coach, 'update');
            $licence?->forceFill(['disputed' => true])->save();
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
