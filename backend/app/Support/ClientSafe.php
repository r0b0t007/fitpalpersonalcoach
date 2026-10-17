<?php

namespace App\Support;

use RuntimeException;

/**
 * A refusal whose message may be shown to the caller: a 4xx with an English sentence from the
 * catalogue (see Say). Anything else that escapes a controller is a 500 with no detail, so no
 * internal message or path ever reaches a browser.
 */
final class ClientSafe extends RuntimeException
{
    public function __construct(public readonly int $status, string $message, public readonly array $extra = [], public readonly array $headers = [])
    {
        parent::__construct($message);
    }
}
