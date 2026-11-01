<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The coach's answer to a follower who asked to join (CHW-337), in the language the form was
 * filled in. Accepted: a button back to the join page, where the browser that asked signs in.
 * Declined: no button, nothing more than no. The account mails' view and words (MailCopy, kinds
 * `joinyes` / `joinno`), greeting no one — the name on the request is whatever was typed.
 */
final class JoinAnswerMail extends Mailable
{
    public readonly array $words;

    public readonly string $lang;

    /** Null on a decline. Public, so the view gets it — Laravel hands a mailable's public properties
     *  to its view over `with` — which is why a decline must not carry one. */
    public readonly ?string $url;

    public function __construct(public readonly bool $accepted, string $coachName, ?string $lang, ?string $url = null)
    {
        $this->url = $accepted ? $url : null;
        $this->lang = in_array($lang, MailCopy::LANGS, true) ? $lang : 'en';
        $this->words = MailCopy::words($this->lang, $accepted ? 'joinyes' : 'joinno', ['coach' => $coachName]);
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
