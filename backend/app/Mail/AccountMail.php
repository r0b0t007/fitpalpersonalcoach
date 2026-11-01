<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The account mails (spec §4a), one class for them all — and since CHW-337 a fourth, `request`:
 * a coach told that someone asked to train with them (no name: that is text a stranger typed). The first three: a sign-in link (`signin`), a link
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

    /** $lang: when the account has no saved language yet (a sign-up's first mail), the app's own. */
    public function __construct(public readonly string $kind, User $user, public readonly ?string $url = null, ?string $email = null, ?string $lang = null)
    {
        $this->lang = in_array($lang, MailCopy::LANGS, true) ? $lang : MailCopy::langFor($user);
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
