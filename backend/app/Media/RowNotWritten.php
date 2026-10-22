<?php

namespace App\Media;

use RuntimeException;
use Throwable;

/**
 * An upload's row could not be written — the one failure the Node API answered 507 ('could not
 * record the upload — is the disk full?'). Thrown inside the transaction to tell it apart from
 * everything else that can fail there (a lock wait, a lost connection), which is an ordinary 500.
 */
final class RowNotWritten extends RuntimeException
{
    public function __construct(Throwable $previous)
    {
        parent::__construct('media row not written', 0, $previous);
    }
}
