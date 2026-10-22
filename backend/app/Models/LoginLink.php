<?php

namespace App\Models;

use App\Support\Js;
use Illuminate\Database\Eloquent\Model;

/**
 * A sign-in link, or a link confirming a new sign-in address (spec §4a). Never tenant-scoped: it
 * is read before anyone is signed in. The token itself is in the mail only; the row holds its hash.
 */
class LoginLink extends Model
{
    /** How long a link works. */
    public const TTL_MINUTES = 15;

    /** Rows older than this are pruned (fitpal:prune). */
    public const KEEP_HOURS = 24;

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $dateFormat = 'Y-m-d H:i:s.v';

    protected $fillable = [];

    protected function casts(): array
    {
        return ['created_at' => 'datetime', 'expires_at' => 'datetime', 'used_at' => 'datetime'];
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * A new link for $user: the token to mail (32 random bytes, base64url), and the row holding
     * its hash. Older unused links stay valid until one of them is used (spendAll): a stranger who
     * keeps asking for a coach's links only sends the coach links they can use, and cannot spend
     * the one already in their inbox.
     *
     * @return array{string, self}
     */
    public static function issue(User $user, string $purpose, ?string $email, ?string $ip): array
    {
        $token = Js::token(32);
        $now = now();
        $link = (new self)->forceFill([
            'id' => 'll_'.Js::token(18), 'user_id' => $user->id, 'purpose' => $purpose, 'email' => $email,
            'token_hash' => self::hash($token), 'created_at' => $now, 'expires_at' => $now->copy()->addMinutes(self::TTL_MINUTES),
            'ip' => $ip,
        ]);
        $link->save();

        return [$token, $link];
    }

    /** Spends every unused link $userId has (of $purpose, or of any): one has just been used. */
    public static function spendAll(string $userId, ?string $purpose = null): void
    {
        self::query()->where('user_id', $userId)->whereNull('used_at')
            ->when($purpose !== null, fn ($q) => $q->where('purpose', $purpose))
            ->update(['used_at' => now()]);
    }
}
