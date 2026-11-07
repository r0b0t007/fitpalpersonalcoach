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
                TextColumn::make('referrer.name')->label('Earned by')->searchable()
                    ->description(fn (ReferralCredit $c) => $c->referrer?->email),
                TextColumn::make('referred.name')->label('Referred coach')->placeholder('Forgotten on objection')
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
                    ->options(fn () => User::query()->whereIn('id', ReferralCredit::query()->select('referrer_id'))
                        ->orderBy('name')->pluck('name', 'id'))
                    ->query(fn (Builder $query, array $data) => filled($data['value'] ?? null)
                        ? $query->where('referrer_id', $data['value']) : $query),
                TernaryFilter::make('used')->nullable()->attribute('used_at'),
            ]);
    }

    /** The referred coach's address and sign-up date: a burst of sign-ups is the tell (spec §7). */
    private static function signedUp(User $coach): string
    {
        $email = $coach->email ?? $coach->pending_email ?? 'no address';
        $disabled = $coach->disabled ? ', disabled' : '';

        return $email.', signed up '.($coach->created_at?->utc()->format('Y-m-d') ?? '?').$disabled;
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
