<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The 6-digit code a follower types to send their request to a coach (CHW-336). The account mails'
 * view and words (MailCopy, kind `joincode`), with the code as the heading and no button: there is
 * no account behind it yet, and the code is typed in the page the follower is on — a link would
 * open another browser than Instagram's, where the request is waiting.
 */
final class JoinCodeMail extends Mailable
{
    public readonly array $words;

    public readonly string $lang;

    public function __construct(public readonly string $code, string $coachName, ?string $lang)
    {
        $this->lang = in_array($lang, MailCopy::LANGS, true) ? $lang : 'en';
        $this->words = MailCopy::words($this->lang, 'joincode', ['code' => $code, 'coach' => $coachName]);
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
            with: ['w' => $this->words, 'url' => null, 'lang' => $this->lang],
        );
    }
}
