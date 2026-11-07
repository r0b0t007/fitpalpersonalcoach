<?php

namespace App\Filament\Resources\ReferralCredits;

use App\Filament\Resources\ReferralCredits\Pages\ListReferralCredits;
use App\Models\ReferralCredit;
use App\Models\User;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

/**
 * Every free month banked by a referral (CHW-350), one row each (CHW-374): who earned it, the
 * referred coach whose activation did, when, and whether and how it was used. The owner reads it
 * before marking a month used, which is where abuse shows (spec §7): one person with several
 * addresses refers themselves. Read-only; "Mark a referral month used" stays on the coach's row.
 *
 * Nothing about the client whose training activated the referral is here: the check keeps only a
 * yes or no (legal notice, "Demander à s'entraîner avec un coach"). A referred coach who objected
 * (fitpal:referral-forget) is no longer named.
 */
class ReferralCreditResource extends Resource
{
    protected static ?string $model = ReferralCredit::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedGiftTop;

    protected static ?string $navigationLabel = 'Referral months';

    protected static ?int $navigationSort = 7;

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('created', 'desc')
            ->modifyQueryUsing(fn (Builder $query) => $query->with(['referrer', 'referred']))
            ->columns([
                // Searchable by the addresses too: a suspicious one is what the owner has in hand.
                TextColumn::make('referrer.name')->label('Earned by')->searchable(['name', 'email', 'pending_email'])
                    ->description(fn (ReferralCredit $c) => $c->referrer === null ? null : self::address($c->referrer)),
                TextColumn::make('referred.name')->label('Referred coach')->searchable(['name', 'email', 'pending_email'])
                    ->state(fn (ReferralCredit $c) => match (true) {
                        $c->referred_id === null => 'Forgotten on objection',
                        $c->referred === null => 'Account deleted',
                        default => $c->referred->name ?? '(no name)',
                    })
                    ->description(fn (ReferralCredit $c) => $c->referred === null ? null : self::signedUp($c->referred)),
                TextColumn::make('months'),
                TextColumn::make('created')->label('Earned')->sortable()
                    ->formatStateUsing(fn (int $state) => self::day($state)),
                TextColumn::make('used_at')->label('Used')->placeholder('Not yet')
                    ->formatStateUsing(fn (int $state) => self::day($state))
                    ->description(fn (ReferralCredit $c) => $c->used_note),
            ])
            ->filters([
                SelectFilter::make('referrer')->label('Earned by')->searchable()
                    // With the address: one person referring themselves often keeps the same name.
                    ->options(fn () => User::query()->whereIn('id', ReferralCredit::query()->select('referrer_id'))
                        ->orderBy('name')->orderBy('id')->get()->mapWithKeys(fn (User $u) => [$u->id => ($u->name ?? '(no name)').' ('.self::address($u).')']))
                    ->attribute('referrer_id'),
                TernaryFilter::make('used')->nullable()->attribute('used_at'),
            ]);
    }

    /** The referred coach's address and sign-up date: a burst of sign-ups is the tell (spec §7). */
    private static function signedUp(User $coach): string
    {
        $disabled = $coach->disabled ? ', disabled' : '';

        return self::address($coach).', signed up '.($coach->created_at?->utc()->format('Y-m-d') ?? '?').$disabled;
    }

    /** A self-serve coach's address is pending until their first link confirms it. */
    private static function address(User $coach): string
    {
        return $coach->email ?? $coach->pending_email ?? 'no address';
    }

    private static function day(int $ms): string
    {
        return gmdate('Y-m-d', intdiv($ms, 1000));
    }

    public static function getPages(): array
    {
        return ['index' => ListReferralCredits::route('/')];
    }
}
