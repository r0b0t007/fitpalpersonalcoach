<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
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

    /**
     * A refusal is not an error: one warning line, as the Node dispatcher's `refused` log, not a
     * stack trace per retry of an over-size upload. Laravel calls this instead of its reporter.
     */
    public function report(): void
    {
        Log::warning('refused', ['status' => $this->status, 'message' => $this->getMessage()]);
    }
}
