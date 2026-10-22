<?php

namespace App\Filament\Resources\Licences;

use App\Admin\Accounts;
use App\Filament\AdminAction;
use App\Filament\Resources\Licences\Pages\ListLicences;
use App\Filament\Resources\Users\UserResource;
use App\Models\Licence;
use App\Models\User;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Http\Request;

/**
 * Every licence row — the one in force and the history behind it (spec §6). Grant and revoke are
 * the admin API's (App\Admin\Accounts); a Creem licence is changed in Creem, so its customer id is
 * there to copy into Creem's dashboard.
 */
class LicenceResource extends Resource
{
    protected static ?string $model = Licence::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedKey;

    protected static ?int $navigationSort = 2;

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('user.name')->label('Coach')->searchable(),
                TextColumn::make('status')->badge()->color(fn (string $state) => match ($state) {
                    'active', 'trialing', 'manual' => 'success',
                    'past_due', 'unpaid', 'paused' => 'warning',
                    'pending' => 'gray',
                    default => 'danger',
                }),
                TextColumn::make('plan')->placeholder('—'),
                TextColumn::make('period')->placeholder('—'),
                TextColumn::make('source'),
                IconColumn::make('in_force')->label('In force')->boolean()
                    ->state(fn (Licence $l) => $l->user?->licence_id === $l->id),
                TextColumn::make('period_end')->label('Period end')->dateTime()->placeholder('—')->sortable(),
                TextColumn::make('trial_ends_at')->label('Trial ends')->dateTime()->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('cancel_at')->label('Ends on')->dateTime()->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('creem_customer_id')->label('Creem customer')->copyable()->placeholder('—')->toggleable(),
                TextColumn::make('creem_subscription_id')->label('Creem subscription')->copyable()->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
                IconColumn::make('disputed')->boolean()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')->label('Created')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status')->options(array_combine($s = ['pending', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'expired', 'manual', 'revoked'], $s)),
                SelectFilter::make('source')->options(['creem' => 'Creem', 'manual' => 'Granted by hand']),
            ])
            ->headerActions([
                Action::make('grant')->label('Grant a plan')->icon(Heroicon::OutlinedGift)
                    ->schema([
                        Select::make('coach')->label('Coach')->required()->searchable()
                            ->options(fn () => User::query()->where('coach', true)->where('admin', false)->where('disabled', false)->orderBy('name')->pluck('name', 'id')),
                        Select::make('plan')->options(UserResource::planOptions())->required(),
                    ])
                    ->action(fn (array $data) => AdminAction::run(fn (Request $r, User $admin) => Accounts::grant($r, $admin, $data['coach'], $data['plan']), 'Plan granted')),
            ])
            ->recordActions([
                Action::make('revoke')->label('Revoke')->icon(Heroicon::OutlinedMinusCircle)->color('danger')
                    ->visible(fn (Licence $l) => $l->source === 'manual' && $l->status === 'manual' && $l->user?->licence_id === $l->id)
                    ->requiresConfirmation()
                    ->action(fn (Licence $l) => AdminAction::run(fn (Request $r, User $admin) => Accounts::revoke($r, $admin, $l->user_id), 'Granted plan revoked')),
            ]);
    }

    public static function getPages(): array
    {
        return ['index' => ListLicences::route('/')];
    }
}
