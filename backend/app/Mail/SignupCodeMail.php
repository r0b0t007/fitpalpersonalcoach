<?php

namespace App\Mail;

use App\Models\CoachSignup;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The 6-digit code a coach types to finish signing up (CHW-368). As the join code (JoinCodeMail):
 * the account mails' view and words (MailCopy, kind `signupcode`), the code as the heading and no
 * button — the code is typed in the page the coach is on, and a link would open another browser
 * than Instagram's.
 */
final class SignupCodeMail extends Mailable
{
    public readonly array $words;

    public readonly string $lang;

    public function __construct(public readonly string $code, ?string $lang)
    {
        $this->lang = in_array($lang, MailCopy::LANGS, true) ? $lang : 'en';
        $this->words = MailCopy::words($this->lang, 'signupcode', ['code' => $code, 'minutes' => CoachSignup::CODE_MINUTES]);
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
