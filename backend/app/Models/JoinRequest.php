<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/**
 * A follower asking to join a coach (CHW-336). Scoped: OwnedByCoach — a coach sees their own
 * requests; the public routes, which act for no coach, find one by its id or token on purpose.
 */
class JoinRequest extends Model
{
    use OwnedByCoach;

    /** A code is good for this long (as a sign-in link is). */
    public const CODE_MINUTES = 15;

    /** Wrong codes before the request must be started again. */
    public const MAX_ATTEMPTS = 5;

    /** Requests waiting on one coach before more are refused. */
    public const MAX_PENDING = 50;

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['email', 'name', 'intake', 'status', 'code_hash', 'attempts', 'code_expires', 'token_hash', 'created', 'decided'];

    protected function casts(): array
    {
        return ['attempts' => 'integer', 'code_expires' => 'integer', 'created' => 'integer', 'decided' => 'integer'];
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(12));
    }

    public static function hash(string $secret): string
    {
        return hash('sha256', $secret);
    }
}
