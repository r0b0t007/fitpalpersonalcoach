<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A coach's sign-up waiting on its emailed code (CHW-368): the Start page's answers, keyed by the
 * address. Not an account: nothing is written to `users` until the code proves the address.
 */
class CoachSignup extends Model
{
    /** A code is good for this long (as a sign-in link's and a join request's are). */
    public const CODE_MINUTES = 15;

    /** Wrong codes before the sign-up must be started again. */
    public const MAX_ATTEMPTS = 5;

    protected $primaryKey = 'email';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['email', 'name', 'lang', 'terms', 'ref', 'code_hash', 'attempts', 'code_expires', 'created'];

    protected function casts(): array
    {
        return ['attempts' => 'integer', 'code_expires' => 'integer', 'created' => 'integer'];
    }

    /**
     * The stored form of a code, keyed with the app key and the address as a sign-in code is
     * (LoginLink::codeHash): six digits are a million guesses for anyone holding a plain hash.
     */
    public static function hash(string $email, string $code): string
    {
        return hash_hmac('sha256', 'signup|'.$email.'|'.$code, (string) config('app.key'));
    }

    /** fitpal:prune: a day after it was started, a sign-up nobody finished goes. */
    public static function prune(int $nowMs): int
    {
        return self::query()->where('created', '<', $nowMs - 86_400_000)->delete();
    }
}
