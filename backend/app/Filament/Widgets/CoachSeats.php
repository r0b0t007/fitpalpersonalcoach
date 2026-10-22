<?php

namespace App\Filament\Widgets;

use App\Filament\Entitlements;
use App\Models\User;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;

/** Each coach's active clients against their plan's cap (Entitlement, as the cap is enforced). */
class CoachSeats extends TableWidget
{
    protected static ?int $sort = 2;

    protected int|string|array $columnSpan = 'full';

    protected ?string $pollingInterval = null;

    public function table(Table $table): Table
    {
        return $table
            ->heading('Clients per coach')
            ->query(User::query()->where('coach', true)->where('disabled', false)->orderBy('name'))
            ->columns([
                TextColumn::make('name')->label('Coach'),
                TextColumn::make('plan')->badge()->state(fn (User $u) => Entitlements::for($u)->status),
                TextColumn::make('seats')->label('Clients')->state(function (User $u) {
                    $e = Entitlements::for($u);

                    return $e->used.' / '.($e->cap ?? '∞');
                })->color(fn (User $u) => Entitlements::for($u)->overCap ? 'danger' : null),
            ])
            ->paginated([10, 25]);
    }
}
