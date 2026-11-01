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

    /** Wrong codes a sign-in mail takes before it is spent (CHW-331). */
    public const MAX_ATTEMPTS = 5;

    /** Rows older than this are pruned (fitpal:prune). */
    public const KEEP_HOURS = 24;

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $dateFormat = 'Y-m-d H:i:s.v';

    protected $fillable = [];

    protected function casts(): array
    {
        return ['created_at' => 'datetime', 'expires_at' => 'datetime', 'used_at' => 'datetime', 'attempts' => 'integer'];
    }

    /** How every address is kept and compared: trimmed, lower-cased (users.email is unique). */
    public static function normaliseEmail(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    public static function validEmail(string $email): bool
    {
        return $email !== '' && strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }

    /** The app's link-landing screen (S6): the token in the hash, never sent to a server log. */
    public static function url(string $token): string
    {
        return config('fitpal.origin').'/#/link?t='.$token;
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * The stored form of a sign-in code: keyed with the app key and the row, as six digits are a
     * million guesses for anyone holding a plain hash.
     */
    public static function codeHash(string $id, string $code): string
    {
        return hash_hmac('sha256', $id.'|'.$code, (string) config('app.key'));
    }

    /**
     * A new link for $user: the token to mail (32 random bytes, base64url), and the row holding
     * its hash. Older unused links stay valid until one of them is used (spendAll): a stranger who
     * keeps asking for a coach's links only sends the coach links they can use, and cannot spend
     * the one already in their inbox.
     *
     * A sign-in link has a 6-digit code too (CHW-331), the way in that stays in the browser it was
     * asked from: a tapped link opens another, and leaves Instagram's. Only the newest code works:
     * a new sign-in mail takes the code off the older ones, whose links keep working. Five wrong
     * tries take a code away too (LoginLinkController::code), and nothing else.
     *
     * @return array{string, self, ?string} the token, the row, and the code (sign-in links only)
     */
    public static function issue(User $user, string $purpose, ?string $email, ?string $ip): array
    {
        $token = Js::token(32);
        $now = now();
        $id = 'll_'.Js::token(18);
        $code = $purpose === 'login' ? str_pad((string) random_int(0, 999_999), 6, '0', STR_PAD_LEFT) : null;
        if ($code !== null) {
            self::query()->where('user_id', $user->id)->where('purpose', 'login')->whereNotNull('code_hash')->update(['code_hash' => null]);
        }
        $link = (new self)->forceFill([
            'id' => $id, 'code_hash' => $code === null ? null : self::codeHash($id, $code), 'user_id' => $user->id, 'purpose' => $purpose, 'email' => $email,
            'token_hash' => self::hash($token), 'created_at' => $now, 'expires_at' => $now->copy()->addMinutes(self::TTL_MINUTES),
            'ip' => $ip,
        ]);
        $link->save();

        return [$token, $link, $code];
    }

    /** Spends every unused link $userId has (of $purpose, or of any): one has just been used. */
    public static function spendAll(string $userId, ?string $purpose = null): void
    {
        self::query()->where('user_id', $userId)->whereNull('used_at')
            ->when($purpose !== null, fn ($q) => $q->where('purpose', $purpose))
            ->update(['used_at' => now()]);
    }
}
