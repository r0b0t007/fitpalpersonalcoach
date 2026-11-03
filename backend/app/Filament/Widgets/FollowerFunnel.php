<?php

namespace App\Filament\Widgets;

use App\Filament\Funnel;
use Filament\Support\Enums\FontWeight;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;

/**
 * The followers' funnel over the last 30 days (CHW-335, Funnel::followers), every coach together
 * first and then each coach by page views: page view → request → code proved → accepted → first
 * workout, and the median time from asking to that workout, the number the growth doc optimises.
 */
class FollowerFunnel extends TableWidget
{
    protected static ?int $sort = 4;

    protected int|string|array $columnSpan = 'full';

    protected ?string $pollingInterval = null;

    private const DAYS = 30;

    public function table(Table $table): Table
    {
        $funnel = Funnel::followers(self::DAYS);
        $since = $funnel['auditSince'];

        return $table
            ->heading('Follower funnel, last '.self::DAYS.' days')
            ->description('Time to first workout: from asking to join to the first workout the server saw.'
                .($since !== null ? ' The audit log holds events since '.gmdate('Y-m-d', intdiv($since, 1000)).' only: requests, codes and accepts count from then.' : ''))
            ->records(fn (): array => $funnel['rows'])
            ->columns([
                TextColumn::make('coach')->label('Coach')->weight(fn (array $record): ?FontWeight => $record['coach'] === 'All coaches' ? FontWeight::Bold : null),
                TextColumn::make('views')->label('Page views'),
                TextColumn::make('requests')->label('Requests'),
                TextColumn::make('verified')->label('Code proved'),
                TextColumn::make('accepted')->label('Accepted'),
                TextColumn::make('trained')->label('First workout'),
                TextColumn::make('median')->label('Time to first workout')->state(fn (array $record): string => self::duration($record['median'])),
            ])
            ->paginated([10, 25]);
    }

    /** A wait as the review reads it: minutes under an hour, hours under two days, then days. */
    public static function duration(?int $ms): string
    {
        return match (true) {
            $ms === null => '—',
            $ms < 3_600_000 => max(1, (int) round($ms / 60_000)).' min',
            $ms < 48 * 3_600_000 => (int) round($ms / 3_600_000).' h',
            default => (int) round($ms / 86_400_000).' days',
        };
    }
}
