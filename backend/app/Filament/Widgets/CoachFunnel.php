<?php

namespace App\Filament\Widgets;

use App\Filament\Funnel;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;

/**
 * The coach funnel by sign-up week (CHW-335, Funnel::coaches): each step as a count and a share —
 * of the week's sign-ups up to activation, of its activated coaches after, as the growth doc sets
 * its targets.
 */
class CoachFunnel extends TableWidget
{
    protected static ?int $sort = 3;

    protected int|string|array $columnSpan = 'full';

    protected ?string $pollingInterval = null;

    public function table(Table $table): Table
    {
        $ofSignups = fn (string $key) => fn (array $record): string => self::share($record[$key], $record['signups']);

        return $table
            ->heading('Coach funnel, by sign-up week')
            ->description('Coaches who signed themselves up. Habit: '.Funnel::HABIT_CLIENTS.'+ clients trained in the last 7 days, for activated coaches '.Funnel::HABIT_DAYS.'+ days in. Paid: activated coaches on a Creem subscription paying now, past any trial.')
            ->records(fn (): array => Funnel::coaches())
            ->columns([
                TextColumn::make('week')->label('Week of'),
                TextColumn::make('signups')->label('Sign-ups'),
                TextColumn::make('page')->label('Page open')->state($ofSignups('page')),
                TextColumn::make('requested')->label('A request')->state($ofSignups('requested')),
                TextColumn::make('client')->label('A client')->state($ofSignups('client')),
                TextColumn::make('activated')->label('Activated')->state($ofSignups('activated'))
                    ->tooltip('a client logged a workout'),
                TextColumn::make('habit')->label('Habit')
                    ->state(fn (array $record): string => $record['habitDue'] === 0 ? '—' : $record['habit'].' of '.$record['habitDue']),
                TextColumn::make('paid')->label('Paid')->state(fn (array $record): string => self::share($record['paid'], $record['activated'])),
            ])
            ->paginated(false);
    }

    /** "n" alone when there is no base, else "n · p%". */
    public static function share(int $n, int $of): string
    {
        return $of === 0 ? (string) $n : $n.' · '.(int) round(100 * $n / $of).'%';
    }
}
