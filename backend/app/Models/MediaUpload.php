<?php

namespace App\Models;

use App\Media\Paths;
use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/**
 * A chunked demo upload in flight (ChunkUploadController). Scoped to its coach (OwnedByCoach): a
 * session id is only ever another coach's "not found".
 */
class MediaUpload extends Model
{
    use OwnedByCoach;

    /** Open sessions a coach may hold; a new one past this drops their oldest (and its bytes). */
    public const MAX_OPEN = 6;

    /** An upload nobody has sent a chunk to for this long is abandoned (fitpal:prune). */
    public const IDLE_MS = 24 * 3600 * 1000;

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['id', 'ex_id', 'label', 'size', 'received', 'created', 'touched'];

    protected function casts(): array
    {
        return ['size' => 'integer', 'received' => 'integer', 'touched' => 'integer'];
    }

    /** Where the bytes so far are assembled: a dotted name Sniff::safeFile never serves. */
    public function partialPath(): string
    {
        return Paths::root().DIRECTORY_SEPARATOR.'ex'.DIRECTORY_SEPARATOR.'.up-'.$this->id;
    }

    /** The session gone, with its bytes. */
    public function discard(): void
    {
        @unlink($this->partialPath());
        $this->delete();
    }
}
