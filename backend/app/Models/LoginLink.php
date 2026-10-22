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
     * its hash. Issuing one spends every unused link of the same purpose the user still has.
     *
     * @return array{string, self}
     */
    public static function issue(User $user, string $purpose, ?string $email, ?string $ip): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = now();
        self::query()->where('user_id', $user->id)->where('purpose', $purpose)->whereNull('used_at')->update(['used_at' => $now]);
        $link = (new self)->forceFill([
            'id' => 'll_'.Js::token(18), 'user_id' => $user->id, 'purpose' => $purpose, 'email' => $email,
            'token_hash' => self::hash($token), 'created_at' => $now, 'expires_at' => $now->copy()->addMinutes(self::TTL_MINUTES),
            'ip' => $ip,
        ]);
        $link->save();

        return [$token, $link];
    }
}
