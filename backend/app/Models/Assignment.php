<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/** A program sent to a client. Scoped to the sending coach: OwnedByCoach. */
class Assignment extends Model
{
    use OwnedByCoach;

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['id', 'coach_id', 'coach_name', 'member_id', 'bundle', 'note', 'schedule', 'status', 'created', 'decided_at'];

    protected function casts(): array
    {
        return ['schedule' => 'boolean'];
    }
}
