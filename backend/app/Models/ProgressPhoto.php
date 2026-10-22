<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A client's progress photo: one per (check-in period, pose). The client's own, not a coach's —
 * there is no CoachContext scope here; who may read one is App\Tenancy\Access::canSeePhotos.
 */
class ProgressPhoto extends Model
{
    /** api/server.js PHOTO_POSES. */
    public const POSES = ['front', 'side', 'back'];

    /** MEDIA_MAX_PHOTOS: per client, not counting a slot being replaced. */
    public const MAX_COUNT = 500;

    /** MEDIA_MAX_PHOTO_TOTAL: 300 MB per client, likewise. */
    public const MAX_TOTAL = 300 * 1024 * 1024;

    protected $primaryKey = 'seq';

    public $timestamps = false;

    protected $fillable = ['id', 'user_id', 'd', 'pose', 'file', 'bytes', 'mime', 'created'];

    protected function casts(): array
    {
        return ['bytes' => 'integer'];
    }

    /** A client's photos as Node's sidecar kept them: by date, a date's poses in upload order. */
    public static function of(string $userId): Builder
    {
        return static::query()->where('user_id', $userId)->orderBy('d')->orderBy('seq');
    }

    /** api/server.js publicPhoto: everything but the stored name, which never leaves the server. */
    public function toPublic(): array
    {
        return ['id' => $this->id, 'd' => $this->d, 'pose' => $this->pose, 'bytes' => $this->bytes, 'mime' => $this->mime, 'created' => $this->created];
    }
}
