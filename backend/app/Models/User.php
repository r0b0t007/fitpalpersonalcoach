<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
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
class User extends Authenticatable implements WebAuthnAuthenticatable
{
    use HasFactory, Notifiable, WebAuthnAuthentication;

    public $incrementing = false;

    protected $keyType = 'string';

    public const UPDATED_AT = null;

    protected $fillable = [
        'id', 'name', 'email', 'admin', 'coach', 'self_serve', 'coach_id', 'disabled', 'sv', 'invited_by',
        'last_reminder', 'last_checkin_reminder', 'created_at',
    ];

    protected $hidden = ['password', 'remember_token'];

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
        return rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '=');
    }

    /**
     * A coach's clients. The coach is passed EXPLICITLY, never read from the request's coach
     * context: the licence cap counts these where there is no context at all (invite redeem,
     * sign-up, the billing webhook, the admin panel, the scheduler). User itself is deliberately
     * not scoped — coaches and admins are users too, and /me must always find its own row.
     *
     * @return Builder<User>
     */
    public static function clientsOf(User|string $coach): Builder
    {
        return static::query()->where('coach_id', $coach instanceof User ? $coach->id : $coach);
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
