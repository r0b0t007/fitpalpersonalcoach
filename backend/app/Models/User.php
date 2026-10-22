<?php

namespace App\Models;

use App\Support\Js;
use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laragear\WebAuthn\Contracts\WebAuthnAuthenticatable;
use Laragear\WebAuthn\WebAuthnAuthentication;
use Laragear\WebAuthn\WebAuthnData;

/**
 * One row per account: coaches, their clients, and the owner. The id is the 16-character
 * base64url string the Node API minted (12 random bytes), kept so every reference in the imported
 * data — coachId, invitedBy, media rows, the passkeys' user handles — still points at the row.
 */
class User extends Authenticatable implements FilamentUser, WebAuthnAuthenticatable
{
    use HasFactory, Notifiable, WebAuthnAuthentication;

    public $incrementing = false;

    protected $keyType = 'string';

    public const UPDATED_AT = null;

    /** Milliseconds kept: `created` round-trips to the app exactly as Node wrote it. */
    protected $dateFormat = 'Y-m-d H:i:s.v';

    protected $fillable = [
        'id', 'name', 'email', 'admin', 'coach', 'self_serve', 'disabled', 'sv', 'invited_by',
        'last_reminder', 'last_checkin_reminder', 'created_at',
    ];

    protected $hidden = ['password', 'remember_token'];

    /**
     * The Filament panel (/admin-panel) is the owner's: admins only, never a disabled account. Its
     * login is email + password on the `web` guard; the owner's password is set on the admin row
     * with `php artisan fitpal:panel-login <id>` (make:filament-user would create a new account),
     * and no other account has one.
     */
    public function canAccessPanel(Panel $panel): bool
    {
        return $this->isAdmin() && ! $this->disabled;
    }

    /** A client's coach (the admin panel's columns); not `coach`, which is the role flag. */
    public function coachAccount(): BelongsTo
    {
        return $this->belongsTo(self::class, 'coach_id');
    }

    protected function casts(): array
    {
        return [
            'admin' => 'boolean',
            'coach' => 'boolean',
            'self_serve' => 'boolean',
            'disabled' => 'boolean',
            'sv' => 'integer',
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'created_at' => 'datetime',
        ];
    }

    /** 16 base64url characters, as the Node API made them. */
    public static function newId(): string
    {
        return Js::randomId();
    }

    /**
     * A coach's clients, disabled ones included. The coach is passed EXPLICITLY, never read from
     * the request's coach context: these are counted where there is no context at all (invite
     * redeem, sign-up, the billing webhook, the admin panel, the scheduler). User itself is
     * deliberately not scoped — coaches and admins are users too, and /me must always find its row.
     *
     * @return Builder<User>
     */
    public static function clientsOf(User|string $coach): Builder
    {
        return static::query()->where('coach_id', $coach instanceof User ? $coach->id : $coach);
    }

    /**
     * Node's order for account lists (db.users as stored): imported accounts in their db.json
     * position, then accounts made here by creation date. The id breaks a tie in the same
     * millisecond, which Node's array order would have broken by signup order.
     */
    public function scopeSignupOrder(Builder $query): Builder
    {
        return $query->orderByRaw('legacy_order is null')->orderBy('legacy_order')
            ->orderBy('created_at')->orderBy('id');
    }

    /**
     * The clients that take a seat: not disabled. This is what the licence cap's `used` counts
     * (spec §6, "a cap on active clients") — a disabled client frees their seat.
     *
     * @return Builder<User>
     */
    public static function activeClientsOf(User|string $coach): Builder
    {
        return static::clientsOf($coach)->where('disabled', false);
    }

    public function isAdmin(): bool
    {
        return $this->admin || in_array($this->id, config('fitpal.admin_uids', []), true);
    }

    /** Admins coach implicitly — they run the instance — but a coach is not an admin. */
    public function isCoach(): bool
    {
        return $this->coach || $this->isAdmin();
    }

    /** `created` as Node wrote it ("2026-05-01T10:20:30.123Z"), or null for the oldest accounts. */
    public function createdIso(): ?string
    {
        return $this->created_at !== null ? Js::iso($this->created_at) : null;
    }

    /** The one shape of "who am I" the app sees, from /me and both verify routes. */
    public function toPublic(): array
    {
        $coach = $this->coach_id ? self::query()->find($this->coach_id) : null;

        return [
            'id' => $this->id, 'name' => $this->name, 'admin' => $this->isAdmin(), 'coach' => $this->isCoach(),
            'coachName' => $coach?->name,
        ];
    }

    /** What the authenticator shows for this passkey: the name twice, since accounts have no email. */
    public function webAuthnData(): WebAuthnData
    {
        return WebAuthnData::make($this->name, $this->name);
    }

    /** The bytes an authenticator stores as the user handle: the ASCII of the id, as the Node API sent it. */
    public function webAuthnHandle(): string
    {
        return rtrim(strtr(base64_encode($this->id), '+/', '-_'), '=');
    }
}
