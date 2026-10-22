<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A row of the activity log, for the admin panel to list (read-only). Written only through
 * App\Audit\Audit::record, which keeps the columns' widths and the retention.
 */
class AuditEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [];

    protected function casts(): array
    {
        return ['ok' => 'boolean', 'ts' => 'integer'];
    }
}
