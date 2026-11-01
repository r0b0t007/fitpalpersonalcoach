<?php

namespace App\Domain;

/**
 * What is sold (spec §2): three tiers that differ only by how many active clients a coach may
 * have, each by the month or the year, six Creem products in all. Prices live in Creem's
 * dashboard, never here. Below them, the Free plan (CHW-329): FREE_CAP active clients for a coach
 * with no paid plan, no card and no Creem needed. It replaced the 14-day trial; the live products
 * are configured without one.
 *
 * CREEM_PRODUCTS maps the tiers to Creem product ids: "solo:month=prod_x,solo:year=prod_y,…".
 * Billing is on only when the key, the webhook secret and at least one product are all set:
 * anything less is billing off (every coach entitled, nothing enforced), and fitpal:check-config
 * says what is missing (problems()).
 */
final class Plans
{
    /** Active clients per tier, in tier order. */
    public const CAPS = ['solo' => 10, 'pro' => 30, 'studio' => 75];

    public const PERIODS = ['month', 'year'];

    /** The client cap of a tier, or null for a name that is not one. */
    public static function cap(?string $plan): ?int
    {
        return $plan !== null ? (self::CAPS[$plan] ?? null) : null;
    }

    /** The Free plan's client cap: FREE_CAP, or 0 when there is no Free plan. */
    public static function freeCap(): int
    {
        return max(0, (int) config('fitpal.free_cap'));
    }

    /** Whether Creem is configured: key, webhook secret and at least one product. */
    public static function billingOn(): bool
    {
        return (string) config('fitpal.creem.api_key') !== ''
            && (string) config('fitpal.creem.webhook_secret') !== ''
            && self::products() !== [];
    }

    /**
     * Whether a coach may sign up on their own (/#/start): SELF_SERVE_COACH, and something to
     * sign up to — a paid plan (billing on) or the Free plan. Never with neither: with no Creem and
     * no FREE_CAP every coach is unlicensed and unlimited, and an invite-only instance would be
     * open to anyone. On the Free plan alone, every account it makes is capped at FREE_CAP.
     */
    public static function selfServeOpen(): bool
    {
        return (bool) config('fitpal.self_serve_coach') && (self::billingOn() || self::freeCap() > 0);
    }

    /**
     * The configured products, plan => period => product id, keeping only well-formed entries.
     *
     * @return array<string, array<string, string>>
     */
    public static function products(): array
    {
        return self::parse()['products'];
    }

    /** The Creem product sold as this plan and period, or null when there is none. */
    public static function product(string $plan, string $period): ?string
    {
        return self::products()[$plan][$period] ?? null;
    }

    /**
     * The plan and period a Creem product id is sold as (a webhook's `product.id`), or null for an
     * id this instance does not sell.
     *
     * @return array{plan: string, period: string}|null
     */
    public static function fromProduct(?string $productId): ?array
    {
        foreach (self::products() as $plan => $periods) {
            foreach ($periods as $period => $id) {
                if ($productId !== null && $productId === $id) {
                    return ['plan' => $plan, 'period' => $period];
                }
            }
        }

        return null;
    }

    /**
     * The plans on sale, for the app: Free first when FREE_CAP is set (no periods: nothing to
     * buy), then each paid tier with its cap and the periods it can be bought for, in tier order
     * — those only while billing is on.
     *
     * @return list<array{plan: string, cap: int, periods: list<string>}>
     */
    public static function offered(): array
    {
        $out = self::freeCap() > 0 ? [['plan' => 'free', 'cap' => self::freeCap(), 'periods' => []]] : [];
        if (! self::billingOn()) {
            return $out;
        }
        $products = self::products();
        foreach (self::CAPS as $plan => $cap) {
            $periods = array_values(array_filter(self::PERIODS, fn ($p) => isset($products[$plan][$p])));
            if ($periods !== []) {
                $out[] = ['plan' => $plan, 'cap' => $cap, 'periods' => $periods];
            }
        }

        return $out;
    }

    /**
     * What is wrong with the Creem configuration, for fitpal:check-config: a partial set (billing
     * then stays off), and each CREEM_PRODUCTS entry that is not `tier:period=id`.
     *
     * @return list<string>
     */
    public static function problems(): array
    {
        // CREEM_PRODUCTS counts as set only when it names a product this instance can sell: a value
        // of nothing but typos turns billing off just as surely as an empty one.
        $set = array_filter([
            'CREEM_API_KEY' => (string) config('fitpal.creem.api_key') !== '',
            'CREEM_WEBHOOK_SECRET' => (string) config('fitpal.creem.webhook_secret') !== '',
            'CREEM_PRODUCTS' => self::products() !== [],
        ]);
        $problems = [];
        if (trim(str_replace(',', '', (string) config('fitpal.creem.products'))) === '' && trim((string) config('fitpal.creem.products')) !== '') {
            $problems[] = 'CREEM_PRODUCTS holds no entry at all.';
        }
        if ($set !== [] && count($set) < 3) {
            $missing = array_diff(['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET', 'CREEM_PRODUCTS'], array_keys($set));
            $problems[] = 'billing is off: '.implode(' and ', $missing).' '.(count($missing) > 1 ? 'are' : 'is').' not set, while '.implode(' and ', array_keys($set)).' '.(count($set) > 1 ? 'are' : 'is').'. Set all three, or none.';
        }
        foreach (self::parse()['bad'] as $entry) {
            $problems[] = "CREEM_PRODUCTS entry \"$entry\" is not tier:period=product (tiers ".implode(', ', array_keys(self::CAPS)).'; periods '.implode(', ', self::PERIODS).') — it is ignored.';
        }

        return $problems;
    }

    /** @var array{string, array{products: array<string, array<string, string>>, bad: list<string>}}|null */
    private static ?array $parsed = null;

    /**
     * CREEM_PRODUCTS read once per value. A product id named twice is refused everywhere it
     * appears — failing closed: a webhook could not tell which tier was bought, and the first
     * spelling winning could grant a dearer tier than the one paid for.
     *
     * @return array{products: array<string, array<string, string>>, bad: list<string>}
     */
    private static function parse(): array
    {
        $raw = (string) config('fitpal.creem.products');
        if (self::$parsed !== null && self::$parsed[0] === $raw) {
            return self::$parsed[1];
        }
        $entries = [];
        $bad = [];
        $ids = [];
        foreach (explode(',', $raw) as $entry) {
            $entry = trim($entry);
            if ($entry === '') {
                continue;
            }
            if (! preg_match('/^([a-z]+):([a-z]+)=(\S+)$/D', $entry, $m) || ! isset(self::CAPS[$m[1]]) || ! in_array($m[2], self::PERIODS, true)
                || isset($entries[$m[1].':'.$m[2]])) {
                // Malformed, an unknown tier or period, or a tier and period given twice.
                $bad[] = $entry;

                continue;
            }
            $entries[$m[1].':'.$m[2]] = [$m[1], $m[2], $m[3], $entry];
            $ids[$m[3]] = ($ids[$m[3]] ?? 0) + 1;
        }
        $products = [];
        foreach ($entries as [$plan, $period, $id, $entry]) {
            if ($ids[$id] > 1) {
                $bad[] = $entry;   // one product sold as two things
            } else {
                $products[$plan][$period] = $id;
            }
        }
        self::$parsed = [$raw, ['products' => $products, 'bad' => $bad]];

        return self::$parsed[1];
    }
}
