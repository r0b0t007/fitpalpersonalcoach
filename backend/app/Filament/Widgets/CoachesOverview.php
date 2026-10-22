<?php

namespace App\Filament\Widgets;

use App\Filament\Entitlements;
use App\Models\User;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * Coaches by where their licence stands (Entitlement), and the payments Creem is chasing. Counted
 * per coach through Entitlement, the rule the API enforces, not a second reading of `licences`.
 */
class CoachesOverview extends StatsOverviewWidget
{
    protected static ?int $sort = 1;

    /** No polling: each refresh reads every coach's licence; the owner reloads when they want. */
    protected ?string $pollingInterval = null;

    protected function getStats(): array
    {
        $by = ['writing' => 0, 'trialing' => 0, 'failing' => 0, 'readOnly' => 0, 'unbilled' => 0];
        // Admins (by flag or ADMIN_UIDS) run the instance; they are nobody's paying coach.
        $coaches = User::query()->where('coach', true)->where('disabled', false)->get()->reject(fn (User $u) => $u->isAdmin());
        foreach ($coaches as $coach) {
            $e = Entitlements::for($coach);
            match (true) {
                // Billing off: every coach writes, and none of them pays.
                $e->status === 'unlicensed' => $by['unbilled']++,
                in_array($e->status, ['past_due', 'unpaid', 'paused'], true) => $by['failing']++,
                ! $e->canWrite => $by['readOnly']++,
                $e->status === 'trialing' => $by['trialing']++,
                default => $by['writing']++,
            };
        }

        if ($by['unbilled'] > 0) {
            return [
                Stat::make('Coaches', (string) $coaches->count()),
                Stat::make('Billing off', (string) $by['unbilled'])->description('no Creem configured: every coach writes, nobody pays'),
            ];
        }

        return [
            Stat::make('Coaches', (string) $coaches->count()),
            Stat::make('Paying or granted', (string) $by['writing']),
            Stat::make('On trial', (string) $by['trialing']),
            Stat::make('Payment failing', (string) $by['failing'])->description('past due, unpaid or paused')
                ->color($by['failing'] > 0 ? 'warning' : 'gray'),
            Stat::make('Read-only', (string) $by['readOnly'])->description('no plan, or it lapsed'),
        ];
    }
}
