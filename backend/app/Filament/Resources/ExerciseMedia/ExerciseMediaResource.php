<?php

namespace App\Filament\Resources\ExerciseMedia;

use App\Admin\Accounts;
use App\Filament\AdminAction;
use App\Filament\Resources\ExerciseMedia\Pages\ListExerciseMedia;
use App\Models\ExerciseMedia;
use App\Models\User;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Http\Request;

/** Coaches' exercise demos, every coach's (no coach context here): per coach, delete file and row. */
class ExerciseMediaResource extends Resource
{
    protected static ?string $model = ExerciseMedia::class;

    protected static ?string $navigationLabel = 'Exercise media';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedFilm;

    protected static ?int $navigationSort = 6;

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('created', 'desc')
            ->columns([
                TextColumn::make('coach.name')->label('Coach'),
                TextColumn::make('ex_id')->label('Exercise')->searchable(),
                TextColumn::make('label')->placeholder('—'),
                TextColumn::make('mime'),
                TextColumn::make('bytes')->label('Size')->formatStateUsing(fn (int $state) => number_format($state / 1048576, 1).' MB'),
                TextColumn::make('status')->badge(),
                TextColumn::make('created')->dateTime(),
            ])
            ->filters([
                SelectFilter::make('coach')->relationship('coach', 'name')->searchable(),
            ])
            ->recordActions([
                Action::make('delete')->label('Delete')->icon(Heroicon::OutlinedTrash)->color('danger')->requiresConfirmation()
                    ->modalDescription('The demo is removed for the coach and every client who sees it.')
                    ->action(fn (ExerciseMedia $m) => AdminAction::run(fn (Request $r, User $admin) => Accounts::deleteMedia($r, $admin, $m->id), 'Demo deleted')),
            ]);
    }

    public static function getPages(): array
    {
        return ['index' => ListExerciseMedia::route('/')];
    }
}
