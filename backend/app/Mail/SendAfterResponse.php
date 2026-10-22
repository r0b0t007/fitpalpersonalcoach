<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

use function Illuminate\Support\defer;

/**
 * Sends a mail once the response is on its way (the app's terminating phase). The route answers
 * the same, as fast, whether a mail goes out or not — `login/email` must not tell a coach's
 * address from an unknown one by its timing — and the mail leaves at once, not when the worker
 * next runs. A failure is logged for the owner without the mail's contents (the link is a secret).
 *
 * Laravel's defer(), not app()->terminating(): terminating callbacks are never cleared, so a
 * long-lived app (a worker, the test suite) would send every earlier request's mail again.
 */
final class SendAfterResponse
{
    public static function to(string $address, Mailable $mail): void
    {
        defer(function () use ($address, $mail) {
            try {
                Mail::to($address)->send($mail);
            } catch (Throwable $e) {
                Log::error('account mail failed', ['mail' => $mail::class, 'error' => $e->getMessage()]);
            }
        });
    }
}
