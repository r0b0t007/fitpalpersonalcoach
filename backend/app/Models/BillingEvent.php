<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A Creem webhook event already applied, by id (spec §6): a redelivery is answered, not reapplied. */
class BillingEvent extends Model
{
    /** How many are kept (fitpal:prune): far more than Creem would ever redeliver. */
    public const KEEP = 1000;

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $dateFormat = 'Y-m-d H:i:s.v';

    protected $fillable = [];

    protected function casts(): array
    {
        return ['at' => 'datetime'];
    }
}
