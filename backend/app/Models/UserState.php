<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** The raw JSON of one account's training state; see DataController for why it stays raw. */
class UserState extends Model
{
    protected $primaryKey = 'user_id';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['user_id', 'state', 'ts'];
}
