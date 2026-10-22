<?php

namespace App\Domain;

/**
 * What is sold (spec §2): three tiers that differ only by how many active clients a coach may
 * have, each by the month or the year, six Creem products in all. Prices live in Creem's
 * dashboard, never here; so does the 14-day trial, which is configured on the products — the
 * number below is what the app says, and must match them.
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

    public const TRIAL_DAYS = 14;

    /** The client cap of a tier, or null for a name that is not one. */
    public static function cap(?string $plan): ?int
    {
        return $plan !== null ? (self::CAPS[$plan] ?? null) : null;
    }

    /** Whether Creem is configured: key, webhook secret and at least one product. */
    public static function billingOn(): bool
    {
        return (string) config('fitpal.creem.api_key') !== ''
            && (string) config('fitpal.creem.webhook_secret') !== ''
            && self::products() !== [];
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
     * The tiers on sale, for the app: each with its cap and the periods it can be bought for, in
     * tier order. Empty while billing is off.
     *
     * @return list<array{plan: string, cap: int, periods: list<string>}>
     */
    public static function offered(): array
    {
        if (! self::billingOn()) {
            return [];
        }
        $out = [];
        foreach (self::CAPS as $plan => $cap) {
            $periods = array_values(array_filter(self::PERIODS, fn ($p) => isset(self::products()[$plan][$p])));
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
        $set = array_filter([
            'CREEM_API_KEY' => (string) config('fitpal.creem.api_key') !== '',
            'CREEM_WEBHOOK_SECRET' => (string) config('fitpal.creem.webhook_secret') !== '',
            'CREEM_PRODUCTS' => trim((string) config('fitpal.creem.products')) !== '',
        ]);
        $problems = [];
        if ($set !== [] && count($set) < 3) {
            $missing = array_diff(['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET', 'CREEM_PRODUCTS'], array_keys($set));
            $problems[] = 'billing is off: '.implode(' and ', $missing).' '.(count($missing) > 1 ? 'are' : 'is').' not set, while '.implode(' and ', array_keys($set)).' '.(count($set) > 1 ? 'are' : 'is').'. Set all three, or none.';
        }
        foreach (self::parse()['bad'] as $entry) {
            $problems[] = "CREEM_PRODUCTS entry \"$entry\" is not tier:period=product (tiers ".implode(', ', array_keys(self::CAPS)).'; periods '.implode(', ', self::PERIODS).') — it is ignored.';
        }

        return $problems;
    }

    /** @return array{products: array<string, array<string, string>>, bad: list<string>} */
    private static function parse(): array
    {
        $products = [];
        $bad = [];
        $seen = [];
        foreach (explode(',', (string) config('fitpal.creem.products')) as $entry) {
            $entry = trim($entry);
            if ($entry === '') {
                continue;
            }
            if (! preg_match('/^([a-z]+):([a-z]+)=(\S+)$/D', $entry, $m) || ! isset(self::CAPS[$m[1]]) || ! in_array($m[2], self::PERIODS, true)
                || isset($products[$m[1]][$m[2]]) || isset($seen[$m[3]])) {
                // Malformed, an unknown tier or period, a tier and period given twice, or one
                // product sold as two things (a webhook could not tell which was bought).
                $bad[] = $entry;

                continue;
            }
            $products[$m[1]][$m[2]] = $m[3];
            $seen[$m[3]] = true;
        }

        return ['products' => $products, 'bad' => $bad];
    }
}
