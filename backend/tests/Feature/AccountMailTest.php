<?php

use App\Mail\AccountMail;
use App\Mail\MailCopy;
use App\Models\User;

/*
 * The account mails in the E1 design (CHW-303). email/signin-link-{lang}.html is the sign-in mail as
 * this backend renders it, kept as the reference markup beside the outreach templates. When the view
 * or the words change on purpose, regenerate them:
 *
 *   MAIL_REFERENCE_WRITE=1 php artisan test --filter=AccountMailTest
 */

const MAIL_REFERENCE_URL = 'https://coach.fitpal.ma/#/link?t=EXAMPLE-TOKEN-0123456789abcdef';

function accountMail(string $kind, string $lang, string $name = 'Ahmed'): AccountMail
{
    $url = $kind === 'changed' ? null : MAIL_REFERENCE_URL;

    return new AccountMail($kind, new User(['name' => $name]), $url, 'new@example.com', $lang);
}

function accountMailText(AccountMail $mail): string
{
    return view('mail.account-text', ['w' => $mail->words, 'url' => $mail->url, 'lang' => $mail->lang])->render();
}

it('renders each mail in each language, the link in both parts where there is one', function (string $kind, string $lang) {
    $mail = accountMail($kind, $lang);
    $html = $mail->render();
    $text = accountMailText($mail);
    $w = $mail->words;

    expect($html)->toContain('<html lang="'.$lang.'">')->toContain('>'.e($w['heading']).'<')->toContain(e($w['hello']))->toContain(e($w['body']))
        ->and($text)->toContain($w['heading'])->toContain($w['hello'])->toContain($w['body'])->toContain($w['footer']);
    if ($kind === 'changed') {
        expect($w)->not->toHaveKey('button')
            ->and($html)->not->toContain('href="https://coach')->not->toContain(e($w['fallback']))
            ->and($text)->not->toContain('https://')->and($w['body'])->toContain('new@example.com');
    } else {
        expect(substr_count($html, 'href="'.e(MAIL_REFERENCE_URL).'"'))->toBe(2)
            ->and($html)->toContain('>'.e($w['button']).'</a>')
            ->and($text)->toContain($w['button'].': '.MAIL_REFERENCE_URL);
    }
})->with(['signin', 'confirm', 'changed'])->with(MailCopy::LANGS);

it('greets the coach by name on its own line, and without one when the account has none', function () {
    expect(accountMail('signin', 'fr')->words['hello'])->toBe('Bonjour Ahmed,')
        ->and(accountMail('changed', 'es')->words['hello'])->toBe('Hola Ahmed:')
        ->and(accountMail('signin', 'de', '  ')->words['hello'])->toBe('Hallo,')
        ->and(accountMail('signin', 'en', '')->words['hello'])->toBe('Hello,')
        ->and(accountMail('signin', 'en', "Ahmed\n\nChioua")->words['hello'])->toBe('Hello Ahmed Chioua,')
        ->and(accountMailText(accountMail('signin', 'en', '')))->not->toContain(':name');
});

it('greets no one in a confirm mail, which goes to an address nobody has proven yet', function (string $lang) {
    $mail = accountMail('confirm', $lang, 'Call +212 600 000000 now');
    expect($mail->words['hello'])->toBe(MailCopy::words($lang, 'signin', ['name' => ''])['hello'])
        ->and($mail->render())->not->toContain('+212')
        ->and(accountMailText($mail))->not->toContain('+212');
})->with(MailCopy::LANGS);

it('keeps French punctuation and "15 minutes" from breaking onto the next line, in every mail', function () {
    foreach (MailCopy::LANGS as $lang) {
        foreach (['signin', 'confirm', 'changed'] as $kind) {
            foreach (MailCopy::words($lang, $kind, ['name' => 'Ahmed', 'email' => 'new@example.com']) as $part => $text) {
                expect($text)->not->toMatch('/15 /u', "{$lang} {$kind}.{$part}: \"15\" and its unit must not break");
                if ($lang === 'fr') {
                    expect($text)->not->toMatch('/ [?!:;]/u', "fr {$kind}.{$part}: a no-break space goes before ? ! : ;");
                }
            }
        }
    }
    expect(accountMail('signin', 'fr')->words['body'])->toContain("15\u{00A0}minutes")
        ->and(accountMail('signin', 'fr')->words['fallback'])->toEndWith("navigateur\u{00A0}:");
});

it('is the markup of email/signin-link-{lang}.html', function (string $lang) {
    $file = base_path("../email/signin-link-{$lang}.html");
    $html = accountMail('signin', $lang)->render();
    if (getenv('MAIL_REFERENCE_WRITE') === '1') {
        file_put_contents($file, $html);
    }
    expect(is_file($file))->toBeTrue("missing {$file}: regenerate it (see the top of this file)")
        ->and(str_replace("\r\n", "\n", (string) file_get_contents($file)))->toBe($html);
})->with(MailCopy::LANGS);
