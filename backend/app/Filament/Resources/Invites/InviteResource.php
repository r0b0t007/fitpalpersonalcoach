<?php

namespace App\Filament\Resources\Invites;

use App\Admin\Accounts;
use App\Filament\AdminAction;
use App\Filament\Resources\Invites\Pages\ListInvites;
use App\Models\Invite;
use App\Models\User;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\TextInput;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * Every invite code — coaches' and the owner's general ones (no coach context here, so the model
 * is unscoped, as on the admin API). Mint and revoke are the admin API's (App\Admin\Accounts).
 */
class InviteResource extends Resource
{
    protected static ?string $model = Invite::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedTicket;

    protected static ?int $navigationSort = 4;

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('seq', 'desc')
            ->columns([
                TextColumn::make('code')->searchable()->copyable(),
                TextColumn::make('coach.name')->label('Coach')->placeholder('General'),
                TextColumn::make('note')->placeholder('—')->limit(40),
                TextColumn::make('created')->label('Created')->dateTime(),
                TextColumn::make('used_at')->label('Used')->dateTime()->placeholder('—'),
                IconColumn::make('revoked')->boolean(),
            ])
            ->filters([
                SelectFilter::make('state')->options(['open' => 'Open', 'used' => 'Used', 'revoked' => 'Revoked'])
                    ->query(fn (Builder $query, array $data) => match ($data['value'] ?? null) {
                        'open' => $query->whereNull('used_by')->where('revoked', false),
                        'used' => $query->whereNotNull('used_by'),
                        'revoked' => $query->where('revoked', true),
                        default => $query,
                    }),
                TernaryFilter::make('general')->label('General codes')
                    ->queries(true: fn (Builder $query) => $query->doesntHave('coach'), false: fn (Builder $query) => $query->has('coach')),
            ])
            ->headerActions([
                Action::make('mint')->label('New general code')->icon(Heroicon::OutlinedPlus)
                    ->schema([TextInput::make('note')->maxLength(60)])   // Invite::mint keeps 60
                    ->action(fn (array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::mintInvite($r, $admin, (string) ($data['note'] ?? '')), 'Code created')),
            ])
            ->recordActions([
                Action::make('revoke')->label('Revoke')->icon(Heroicon::OutlinedNoSymbol)->color('danger')
                    ->visible(fn (Invite $i) => $i->used_by === null && ! $i->revoked)->requiresConfirmation()
                    ->action(fn (Invite $i) => AdminAction::run(fn (Request $r, User $admin) => Accounts::revokeInvite($r, $admin, $i->code), 'Code revoked')),
            ]);
    }

    public static function getPages(): array
    {
        return ['index' => ListInvites::route('/')];
    }
}
