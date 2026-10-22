<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The account mails (spec §4a), one class for the three: a sign-in link (`signin`), a link
 * confirming a new sign-in address (`confirm`, sent to that address), and the notice to the old
 * address that it was replaced (`changed`, no link). HTML and plain-text parts, the same words,
 * in the coach's language (MailCopy).
 *
 * Sent after the response (the controllers), not queued: the link works for 15 minutes and the
 * worker may run only every few minutes, and a queued job would keep the token in the jobs table.
 */
final class AccountMail extends Mailable
{
    public readonly array $words;

    public readonly string $lang;

    public function __construct(public readonly string $kind, User $user, public readonly ?string $url = null, ?string $email = null)
    {
        $this->lang = MailCopy::langFor($user);
        $this->words = MailCopy::words($this->lang, $kind, ['name' => $user->name, 'email' => $email]);
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->words['subject']);
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.account',
            text: 'mail.account-text',
            with: ['w' => $this->words, 'url' => $this->url, 'lang' => $this->lang],
        );
    }
}
