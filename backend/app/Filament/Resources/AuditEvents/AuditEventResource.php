<?php

namespace App\Filament\Resources\AuditEvents;

use App\Audit\Audit;
use App\Filament\Resources\AuditEvents\Pages\ListAuditEvents;
use App\Models\AuditEvent;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

/** The activity log, newest first, read-only: by category (the event's first part) and outcome. */
class AuditEventResource extends Resource
{
    protected static ?string $model = AuditEvent::class;

    protected static ?string $navigationLabel = 'Activity log';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClipboardDocumentList;

    protected static ?int $navigationSort = 5;

    /** What retention keeps (AUDIT_DAYS, AUDIT_MAX), as the API serves it — even before the hourly prune. */
    public static function getEloquentQuery(): Builder
    {
        $query = parent::getEloquentQuery();
        Audit::kept($query->getQuery());

        return $query;
    }

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('id', 'desc')
            ->columns([
                TextColumn::make('ts')->label('When')->sortable()
                    ->formatStateUsing(fn (int $state) => now()->createFromTimestampMs($state)->utc()->format('Y-m-d H:i:s').' UTC'),
                TextColumn::make('ev')->label('Event')->searchable(),
                IconColumn::make('ok')->boolean(),
                TextColumn::make('name')->label('By')->placeholder('—')->searchable(),
                TextColumn::make('tname')->label('About')->placeholder('—'),
                TextColumn::make('msg')->placeholder('—')->limit(40),
                TextColumn::make('ip')->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('category')->options(array_combine($c = ['auth', 'login', 'account', 'admin', 'coach', 'invite', 'billing'], $c))
                    ->query(fn (Builder $query, array $data) => ($data['value'] ?? null) ? $query->where('ev', 'like', $data['value'].'.%') : $query),
                TernaryFilter::make('ok')->label('Outcome')->trueLabel('Succeeded')->falseLabel('Refused or failed'),
            ]);
    }

    public static function getPages(): array
    {
        return ['index' => ListAuditEvents::route('/')];
    }
}
