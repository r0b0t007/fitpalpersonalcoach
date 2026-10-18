<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/** A sign-up code (migration 2026_10_18_130000). Scoped to the acting coach: OwnedByCoach. */
class Invite extends Model
{
    use OwnedByCoach;

    protected $primaryKey = 'code';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['code', 'note', 'created_by', 'coach_id', 'created', 'used_by', 'used_at', 'revoked', 'revoked_at', 'revoked_reason'];

    protected function casts(): array
    {
        return ['revoked' => 'boolean'];
    }
}
