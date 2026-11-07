<?php

namespace App\Filament\Resources\Users;

use App\Admin\Accounts;
use App\Coaching\Referrals;
use App\Domain\Entitlement;
use App\Domain\Plans;
use App\Filament\AdminAction;
use App\Filament\Entitlements;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Models\User;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Forms\Components\Select;
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
            ->modifyQueryUsing(fn (Builder $query) => $query->withSum(['referralCredits as referral_months' => fn ($q) => $q->whereNull('used_at')], 'months'))
            ->columns([
                TextColumn::make('name')->searchable()->sortable(),
                // A self-serve coach's address is pending until their first link confirms it, and the
                // owner finds a new coach by the address they gave (docs/growth/done-for-you.md).
                TextColumn::make('email')->searchable(['email', 'pending_email'])->toggleable()
                    ->state(fn (User $u) => match (true) {
                        $u->pending_email === null => $u->email,
                        $u->email === null => "{$u->pending_email} (unconfirmed)",
                        default => "{$u->email} → {$u->pending_email} (unconfirmed)",   // a change of address under way
                    }),
                TextColumn::make('role')->badge()
                    ->state(fn (User $u) => $u->isAdmin() ? 'admin' : ($u->isCoach() ? 'coach' : 'client')),
                TextColumn::make('coachAccount.name')->label('Coach')->placeholder('—'),
                TextColumn::make('plan')->badge()->placeholder('—')
                    ->state(fn (User $u) => $u->isCoach() && ! $u->isAdmin() ? Entitlements::for($u)->status : null),
                // Referral months not used yet (CHW-350): the owner applies one when the coach pays.
                TextColumn::make('referralMonths')->label('Referral months')->placeholder('—')->toggleable()
                    ->state(fn (User $u) => $u->isCoach() ? ((int) ($u->referral_months ?? 0) ?: null) : null),
                IconColumn::make('disabled')->boolean(),
                TextColumn::make('created_at')->label('Created')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('role')->options(['coach' => 'Coaches', 'client' => 'Clients', 'admin' => 'Admins'])
                    // As id lists, not nested where() closures (the filter's builder carries no model
                    // for them). An admin, by flag or ADMIN_UIDS, coaches too (isCoach).
                    ->query(fn (Builder $query, array $data) => match ($data['value'] ?? null) {
                        'coach' => $query->whereIn('id', self::coachIds()),
                        'client' => $query->whereNotIn('id', self::coachIds()),
                        'admin' => $query->whereIn('id', self::adminIds()),
                        default => $query,
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
                                ->options(fn () => User::query()->where('disabled', false)->whereIn('id', self::coachIds())->orderBy('name')->pluck('name', 'id')),
                        ])
                        ->fillForm(fn (User $u) => ['coachId' => $u->coach_id])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::assignCoach($r, $admin, $u->id, (string) ($data['coachId'] ?? '')), 'Coach updated')),
                    Action::make('grant')->label('Grant a plan')->icon(Heroicon::OutlinedGift)
                        ->visible(fn (User $u) => $u->isCoach() && ! $u->isAdmin() && ! $u->disabled)
                        ->schema([Select::make('plan')->options(self::planOptions())->required()])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::grant($r, $admin, $u->id, $data['plan']), 'Plan granted')),
                    Action::make('useReferralMonth')->label('Mark a referral month used')->icon(Heroicon::OutlinedCheckBadge)
                        ->visible(fn (User $u) => $u->isCoach() && (int) ($u->referral_months ?? 0) > 0)
                        ->schema([TextInput::make('note')->label('How it was applied')->required()->maxLength(120)])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Referrals::markUsed($r, $admin, $u->id, (string) $data['note']), 'Referral month marked used')),
                    // The done-for-you setup (CHW-348): a program built in the owner's own library,
                    // copied into the coach's (docs/growth/done-for-you.md).
                    Action::make('copyProgram')->label('Copy a program to this coach')->icon(Heroicon::OutlinedDocumentDuplicate)
                        ->visible(fn (User $u) => $u->isCoach() && ! $u->disabled && $u->id !== auth('web')->id())
                        ->schema([
                            Select::make('programId')->label('One of your programs')->required()
                                ->options(fn () => Accounts::copyablePrograms(auth('web')->user()))
                                ->helperText('A program saved before a newer rule is left out until you open and save it again.'),
                        ])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::copyProgram($r, $admin, $u->id, $data['programId'] ?? null), 'Program copied')),
                    Action::make('revokeGrant')->label('Revoke granted plan')->icon(Heroicon::OutlinedMinusCircle)->color('danger')
                        ->visible(fn (User $u) => Entitlement::licenceOf($u)?->source === 'manual')->requiresConfirmation()
                        ->action(fn (User $u) => AdminAction::run(fn (Request $r, User $admin) => Accounts::revoke($r, $admin, $u->id), 'Granted plan revoked')),
                ]),
            ]);
    }

    /** @return list<string> admins as isAdmin() has them: the flag, or ADMIN_UIDS */
    private static function adminIds(): array
    {
        return array_values(array_unique([...User::query()->where('admin', true)->pluck('id')->all(), ...(array) config('fitpal.admin_uids', [])]));
    }

    /** @return list<string> everyone who may coach (isCoach): the coach flag, or an admin */
    private static function coachIds(): array
    {
        return array_values(array_unique([...User::query()->where('coach', true)->pluck('id')->all(), ...self::adminIds()]));
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
