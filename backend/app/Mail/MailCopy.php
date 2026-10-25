<?php

namespace App\Mail;

use App\Coaching\MemberCard;
use App\Models\User;

/**
 * The words of the account mails, in the languages the app has (spec §4a: fr, en, es, de, falling
 * back to en), and the language to use: the one the app itself is set to, `user_states.state->lang`
 * (MemberCard::lang) — not a column, which would go stale the first time the coach changes it.
 *
 * The words are the E1 brief's (CHW-234), `vous` in French throughout. The greeting is its own
 * line (`hello`, or `hello.anon` for an account with no name), as each language writes one: a capital
 * after it in en, fr and es, lower case in de; a colon in es. French puts a no-break space before
 * ? and :, and every language keeps "15 minutes" on one line.
 */
final class MailCopy
{
    public const LANGS = ['en', 'fr', 'es', 'de'];

    private const COPY = [
        'en' => [
            'signin.subject' => 'Your FitPal Coach sign-in link',
            'signin.heading' => 'Your sign-in link',
            'hello' => 'Hello :name,',
            'hello.anon' => 'Hello,',
            'signin.body' => 'Here is your link to sign in to FitPal Coach. It works once, for 15 minutes.',
            'signin.button' => 'Sign me in',
            'signin.footer' => 'Did not ask for this? Ignore this message — nobody can sign in without this link.',
            'confirm.subject' => 'Confirm your new FitPal Coach email',
            'confirm.heading' => 'Confirm your new address',
            'confirm.body' => 'Open this link to make :email your FitPal Coach sign-in address. It works once, for 15 minutes.',
            'confirm.button' => 'Confirm this address',
            'confirm.footer' => 'Did not ask for this? Ignore this message — your sign-in address stays as it is.',
            'changed.subject' => 'Your FitPal Coach sign-in email was changed',
            'changed.heading' => 'Your sign-in address changed',
            'changed.body' => 'Sign-in links for your FitPal Coach account now go to :email instead of this address.',
            'changed.footer' => 'If that was not you, reply to this message so we can lock the account and put it right.',
            'fallback' => 'The button does not work? Copy this link into your browser:',
        ],
        'fr' => [
            'signin.subject' => 'Votre lien de connexion FitPal Coach',
            'signin.heading' => 'Votre lien de connexion',
            'hello' => 'Bonjour :name,',
            'hello.anon' => 'Bonjour,',
            'signin.body' => 'Voici votre lien pour vous connecter à FitPal Coach. Il fonctionne une seule fois, pendant 15 minutes.',
            'signin.button' => 'Me connecter',
            'signin.footer' => 'Vous n’avez rien demandé ? Ignorez ce message — personne ne peut se connecter sans ce lien.',
            'confirm.subject' => 'Confirmez votre nouvelle adresse FitPal Coach',
            'confirm.heading' => 'Confirmez votre nouvelle adresse',
            'confirm.body' => 'Ouvrez ce lien pour faire de :email votre adresse de connexion FitPal Coach. Il fonctionne une seule fois, pendant 15 minutes.',
            'confirm.button' => 'Confirmer cette adresse',
            'confirm.footer' => 'Vous n’avez rien demandé ? Ignorez ce message — votre adresse de connexion ne change pas.',
            'changed.subject' => 'Votre adresse de connexion FitPal Coach a changé',
            'changed.heading' => 'Votre adresse de connexion a changé',
            'changed.body' => 'Les liens de connexion de votre compte FitPal Coach sont désormais envoyés à :email, et non plus à cette adresse.',
            'changed.footer' => 'Si ce n’était pas vous, répondez à ce message pour que nous bloquions le compte et rétablissions la situation.',
            'fallback' => 'Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :',
        ],
        'es' => [
            'signin.subject' => 'Tu enlace de acceso a FitPal Coach',
            'signin.heading' => 'Tu enlace de acceso',
            'hello' => 'Hola :name:',
            'hello.anon' => 'Hola:',
            'signin.body' => 'Aquí tienes tu enlace para entrar en FitPal Coach. Funciona una sola vez, durante 15 minutos.',
            'signin.button' => 'Entrar',
            'signin.footer' => '¿No lo has pedido? Ignora este mensaje: nadie puede entrar sin este enlace.',
            'confirm.subject' => 'Confirma tu nuevo correo de FitPal Coach',
            'confirm.heading' => 'Confirma tu nueva dirección',
            'confirm.body' => 'Abre este enlace para que :email sea tu dirección de acceso a FitPal Coach. Funciona una sola vez, durante 15 minutos.',
            'confirm.button' => 'Confirmar esta dirección',
            'confirm.footer' => '¿No lo has pedido? Ignora este mensaje: tu dirección de acceso no cambia.',
            'changed.subject' => 'Tu correo de acceso a FitPal Coach ha cambiado',
            'changed.heading' => 'Tu dirección de acceso ha cambiado',
            'changed.body' => 'Los enlaces de acceso de tu cuenta de FitPal Coach ahora se envían a :email en lugar de a esta dirección.',
            'changed.footer' => 'Si no has sido tú, responde a este mensaje para que bloqueemos la cuenta y lo arreglemos.',
            'fallback' => '¿El botón no funciona? Copia este enlace en tu navegador:',
        ],
        'de' => [
            'signin.subject' => 'Dein Anmeldelink für FitPal Coach',
            'signin.heading' => 'Dein Anmeldelink',
            'hello' => 'Hallo :name,',
            'hello.anon' => 'Hallo,',
            'signin.body' => 'hier ist dein Link, um dich bei FitPal Coach anzumelden. Er funktioniert einmal, 15 Minuten lang.',
            'signin.button' => 'Anmelden',
            'signin.footer' => 'Nicht angefordert? Ignoriere diese Nachricht — ohne diesen Link kann sich niemand anmelden.',
            'confirm.subject' => 'Bestätige deine neue E-Mail-Adresse für FitPal Coach',
            'confirm.heading' => 'Bestätige deine neue Adresse',
            'confirm.body' => 'öffne diesen Link, um :email zu deiner Anmeldeadresse für FitPal Coach zu machen. Er funktioniert einmal, 15 Minuten lang.',
            'confirm.button' => 'Diese Adresse bestätigen',
            'confirm.footer' => 'Nicht angefordert? Ignoriere diese Nachricht — deine Anmeldeadresse bleibt, wie sie ist.',
            'changed.subject' => 'Deine Anmelde-E-Mail für FitPal Coach wurde geändert',
            'changed.heading' => 'Deine Anmeldeadresse wurde geändert',
            'changed.body' => 'Anmeldelinks für dein FitPal-Coach-Konto gehen jetzt an :email statt an diese Adresse.',
            'changed.footer' => 'Warst du das nicht? Antworte auf diese Nachricht, damit wir das Konto sperren und es in Ordnung bringen.',
            'fallback' => 'Der Button funktioniert nicht? Kopiere diesen Link in deinen Browser:',
        ],
    ];

    public static function langFor(User $user): string
    {
        $lang = MemberCard::lang($user->id);

        return in_array($lang, self::LANGS, true) ? $lang : 'en';
    }

    /** The words for $lang, :name and :email filled in. */
    public static function words(string $lang, string $kind, array $fill): array
    {
        $copy = self::COPY[$lang] ?? self::COPY['en'];
        $name = trim((string) ($fill['name'] ?? ''));
        $out = ['fallback' => $copy['fallback'], 'hello' => $name === '' ? $copy['hello.anon'] : strtr($copy['hello'], [':name' => $name])];
        foreach (['subject', 'heading', 'body', 'button', 'footer'] as $part) {
            if (isset($copy["{$kind}.{$part}"])) {
                $out[$part] = strtr($copy["{$kind}.{$part}"], [':name' => $fill['name'] ?? '', ':email' => $fill['email'] ?? '']);
            }
        }

        return $out;
    }

    /** For the check that every language says everything English does. */
    public static function keys(string $lang): array
    {
        return array_keys(self::COPY[$lang] ?? []);
    }
}
