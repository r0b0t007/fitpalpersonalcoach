<?php

namespace App\Filament\Resources\BillingEvents;

use App\Filament\Resources\BillingEvents\Pages\ListBillingEvents;
use App\Models\BillingEvent;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

/**
 * The Creem webhook event ids received, newest first (read-only: they exist so a redelivery is
 * recognised; what each did is in the activity log as billing.*).
 */
class BillingEventResource extends Resource
{
    protected static ?string $model = BillingEvent::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedBanknotes;

    protected static ?int $navigationSort = 3;

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('at', 'desc')
            ->columns([
                TextColumn::make('id')->label('Creem event')->searchable()->copyable(),
                TextColumn::make('at')->label('Received')->dateTime()->sortable(),
            ]);
    }

    public static function getPages(): array
    {
        return ['index' => ListBillingEvents::route('/')];
    }
}
