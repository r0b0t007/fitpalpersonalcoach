<?php

namespace App\Filament\Resources\Users;

use App\Admin\Accounts;
use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Filament\AdminAction;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Models\User;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Forms\Components\Select;
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
 * Every account: coaches, their clients, the owner. The actions are the admin API's own
 * (App\Admin\Accounts): disable, the coach role, a client's coach, a licence by hand.
 */
class UserResource extends Resource
{
    protected static ?string $model = User::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUsers;

    protected static ?int $navigationSort = 1;

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('email')->searchable()->toggleable(),
                TextColumn::make('role')->badge()
                    ->state(fn (User $u) => $u->isAdmin() ? 'admin' : ($u->isCoach() ? 'coach' : 'client')),
                TextColumn::make('coachAccount.name')->label('Coach')->placeholder('—'),
                TextColumn::make('plan')->badge()->placeholder('—')
                    ->state(fn (User $u) => $u->isCoach() && ! $u->isAdmin() ? Entitlement::for($u)->status : null),
                IconColumn::make('disabled')->boolean(),
                TextColumn::make('created_at')->label('Created')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('role')->options(['coach' => 'Coaches', 'client' => 'Clients', 'admin' => 'Admins'])
                    ->query(fn (Builder $q, array $data) => match ($data['value'] ?? null) {
                        'coach' => $q->where('coach', true),
                        'client' => $q->where('coach', false)->where('admin', false),
                        'admin' => $q->where('admin', true),
                        default => $q,
                    }),
                TernaryFilter::make('disabled'),
            ])
            ->recordActions([
                ActionGroup::make([
                    Action::make('disable')->label('Disable')->icon(Heroicon::OutlinedNoSymbol)->color('danger')
                        ->visible(fn (User $u) => ! $u->disabled && ! $u->isAdmin())->requiresConfirmation()
                        ->action(fn (User $u) => AdminAction::run(fn (Request $r, User $admin) => Accounts::disable($r, $admin, $u->id, true), 'Account disabled')),
                    Action::make('enable')->label('Re-enable')->icon(Heroicon::OutlinedCheckCircle)
                        ->visible(fn (User $u) => $u->disabled)
                        ->action(fn (User $u) => AdminAction::run(fn (Request $r, User $admin) => Accounts::disable($r, $admin, $u->id, false), 'Account re-enabled')),
                    Action::make('makeCoach')->label('Make coach')->icon(Heroicon::OutlinedAcademicCap)
                        ->visible(fn (User $u) => ! $u->isCoach() && ! $u->disabled)->requiresConfirmation()
                        ->action(fn (User $u) => AdminAction::run(fn (Request $r, User $admin) => Accounts::setCoach($r, $admin, $u->id, true), 'Now a coach')),
                    Action::make('removeCoach')->label('Remove coach role')->icon(Heroicon::OutlinedXMark)->color('danger')
                        ->visible(fn (User $u) => (bool) $u->coach && ! $u->isAdmin())->requiresConfirmation()
                        ->modalDescription('Their clients are released and their pending offers withdrawn.')
                        ->action(fn (User $u) => AdminAction::run(fn (Request $r, User $admin) => Accounts::setCoach($r, $admin, $u->id, false), 'Coach role removed')),
                    Action::make('assignCoach')->label('Assign coach')->icon(Heroicon::OutlinedArrowsRightLeft)
                        ->visible(fn (User $u) => ! $u->isCoach())
                        ->schema([
                            Select::make('coachId')->label('Coach')->placeholder('No coach')
                                ->options(fn () => User::query()->where('disabled', false)
                                    ->where(fn ($q) => $q->where('coach', true)->orWhere('admin', true))->orderBy('name')->pluck('name', 'id')),
                        ])
                        ->fillForm(fn (User $u) => ['coachId' => $u->coach_id])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::assignCoach($r, $admin, $u->id, (string) ($data['coachId'] ?? '')), 'Coach updated')),
                    Action::make('grant')->label('Grant a plan')->icon(Heroicon::OutlinedGift)
                        ->visible(fn (User $u) => $u->isCoach() && ! $u->isAdmin() && ! $u->disabled)
                        ->schema([Select::make('plan')->options(self::planOptions())->required()])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::grant($r, $admin, $u->id, $data['plan']), 'Plan granted')),
                    Action::make('revokeGrant')->label('Revoke granted plan')->icon(Heroicon::OutlinedMinusCircle)->color('danger')
                        ->visible(fn (User $u) => Entitlement::licenceOf($u)?->source === 'manual')->requiresConfirmation()
                        ->action(fn (User $u) => AdminAction::run(fn (Request $r, User $admin) => Accounts::revoke($r, $admin, $u->id), 'Granted plan revoked')),
                ]),
            ]);
    }

    /** @return array<string, string> */
    public static function planOptions(): array
    {
        $out = [];
        foreach (Plans::CAPS as $plan => $cap) {
            $out[$plan] = ucfirst($plan)." ({$cap} clients)";
        }

        return $out;
    }

    public static function getPages(): array
    {
        return ['index' => ListUsers::route('/')];
    }
}
