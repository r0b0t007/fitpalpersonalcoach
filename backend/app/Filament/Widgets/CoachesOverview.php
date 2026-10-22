<?php

namespace App\Filament\Widgets;

use App\Domain\Entitlement;
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

    protected function getStats(): array
    {
        $by = ['writing' => 0, 'trialing' => 0, 'failing' => 0, 'readOnly' => 0];
        $coaches = User::query()->where('coach', true)->where('admin', false)->where('disabled', false)->get();
        foreach ($coaches as $coach) {
            $e = Entitlement::for($coach);
            match (true) {
                in_array($e->status, ['past_due', 'unpaid', 'paused'], true) => $by['failing']++,
                ! $e->canWrite => $by['readOnly']++,
                $e->status === 'trialing' => $by['trialing']++,
                default => $by['writing']++,
            };
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
