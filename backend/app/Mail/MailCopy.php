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
            'signin.subject' => 'Your FitPal Coach code: :code',
            'signin.heading' => ':code',
            'hello' => 'Hello :name,',
            'hello.anon' => 'Hello,',
            'signin.body' => 'Enter this code to sign in to FitPal Coach, or use the button below. Either works once, for 15 minutes.',
            'signin.button' => 'Sign me in',
            'signin.footer' => 'Did not ask for this? Ignore this message — nobody can sign in without this code.',
            'confirm.subject' => 'Confirm your new FitPal Coach email',
            'confirm.heading' => 'Confirm your new address',
            'confirm.body' => 'Open this link to make :email your FitPal Coach sign-in address. It works once, for 15 minutes.',
            'confirm.button' => 'Confirm this address',
            'confirm.footer' => 'Did not ask for this? Ignore this message — your sign-in address stays as it is.',
            'changed.subject' => 'Your FitPal Coach sign-in email was changed',
            'changed.heading' => 'Your sign-in address changed',
            'changed.body' => 'Sign-in links for your FitPal Coach account now go to :email instead of this address.',
            'changed.footer' => 'If that was not you, reply to this message so we can lock the account and put it right.',
            'joincode.subject' => 'Your FitPal code: :code',
            'joincode.heading' => ':code',
            'joincode.body' => 'Enter this code to send your request to :coach. It works for :minutes minutes.',
            'joincode.footer' => 'Did not ask for this? Ignore this message — nothing is sent without this code.',
            'request.subject' => 'A new request on FitPal Coach',
            'request.heading' => 'Someone wants to train with you',
            'request.body' => 'Someone asked to train with you from your page. Open FitPal Coach to see their answers and accept or decline.',
            'request.button' => 'Open my requests',
            'request.footer' => 'You get this because your page is open. Close it from Account › My page to stop new requests.',
            'joinyes.subject' => ':coach accepted you on FitPal Coach',
            'joinyes.heading' => ':coach accepted you',
            'joinyes.body' => 'Open the page you asked from, on the same phone, to start training. Your program is waiting in the app.',
            'joinyes.button' => 'Start training',
            'joinyes.footer' => 'This link opens your request; it signs you in only on the phone you asked from.',
            'joinno.subject' => 'Your request to :coach',
            'joinno.heading' => 'Not this time',
            'joinno.body' => ':coach cannot take you on right now. Nothing was kept beyond your request, which is deleted in 30 days.',
            'joinno.footer' => 'You can ask again later from their page.',
            'note.subject' => ':coach replied to you',
            'note.heading' => ':coach replied',
            'note.body' => 'Open the app to read what :coach wrote about your training.',
            'note.button' => 'Open the app',
            'note.footer' => 'You get at most one of these emails a day. Turn on notifications in the app to hear sooner.',
            'fallback' => 'The button does not work? Copy this link into your browser:',
        ],
        'fr' => [
            'signin.subject' => 'Votre code FitPal Coach : :code',
            'signin.heading' => ':code',
            'hello' => 'Bonjour :name,',
            'hello.anon' => 'Bonjour,',
            'signin.body' => 'Saisissez ce code pour vous connecter à FitPal Coach, ou utilisez le bouton ci-dessous. L’un comme l’autre fonctionne une seule fois, pendant 15 minutes.',
            'signin.button' => 'Me connecter',
            'signin.footer' => 'Vous n’avez rien demandé ? Ignorez ce message — personne ne peut se connecter sans ce code.',
            'confirm.subject' => 'Confirmez votre nouvelle adresse FitPal Coach',
            'confirm.heading' => 'Confirmez votre nouvelle adresse',
            'confirm.body' => 'Ouvrez ce lien pour faire de :email votre adresse de connexion FitPal Coach. Il fonctionne une seule fois, pendant 15 minutes.',
            'confirm.button' => 'Confirmer cette adresse',
            'confirm.footer' => 'Vous n’avez rien demandé ? Ignorez ce message — votre adresse de connexion ne change pas.',
            'changed.subject' => 'Votre adresse de connexion FitPal Coach a changé',
            'changed.heading' => 'Votre adresse de connexion a changé',
            'changed.body' => 'Les liens de connexion de votre compte FitPal Coach sont désormais envoyés à :email, et non plus à cette adresse.',
            'changed.footer' => 'Si ce n’était pas vous, répondez à ce message pour que nous bloquions le compte et rétablissions la situation.',
            'joincode.subject' => 'Votre code FitPal : :code',
            'joincode.heading' => ':code',
            'joincode.body' => 'Saisissez ce code pour envoyer votre demande à :coach. Il est valable :minutes minutes.',
            'joincode.footer' => 'Vous n’avez rien demandé ? Ignorez ce message — rien n’est envoyé sans ce code.',
            'request.subject' => 'Nouvelle demande sur FitPal Coach',
            'request.heading' => 'Quelqu’un veut s’entraîner avec vous',
            'request.body' => 'Quelqu’un a demandé à s’entraîner avec vous depuis votre page. Ouvrez FitPal Coach pour voir ses réponses et accepter ou refuser.',
            'request.button' => 'Voir mes demandes',
            'request.footer' => 'Vous recevez ce message parce que votre page est ouverte. Fermez-la depuis Compte › Ma page pour ne plus recevoir de demandes.',
            'joinyes.subject' => ':coach vous a accepté sur FitPal Coach',
            'joinyes.heading' => ':coach vous a accepté',
            'joinyes.body' => 'Ouvrez la page d’où vous avez fait la demande, sur le même téléphone, pour commencer. Votre programme vous attend dans l’app.',
            'joinyes.button' => 'Commencer à m’entraîner',
            'joinyes.footer' => 'Ce lien ouvre votre demande ; il ne vous connecte que sur le téléphone d’où vous l’avez faite.',
            'joinno.subject' => 'Votre demande à :coach',
            'joinno.heading' => 'Pas cette fois',
            'joinno.body' => ':coach ne peut pas vous prendre pour le moment. Rien n’a été conservé à part votre demande, supprimée sous 30 jours.',
            'joinno.footer' => 'Vous pourrez redemander plus tard depuis sa page.',
            'note.subject' => ':coach vous a répondu',
            'note.heading' => ':coach vous a répondu',
            'note.body' => 'Ouvrez l’application pour lire ce que :coach a écrit sur votre entraînement.',
            'note.button' => 'Ouvrir l’application',
            'note.footer' => 'Vous recevez au plus un e-mail de ce type par jour. Activez les notifications dans l’application pour l’apprendre plus vite.',
            'fallback' => 'Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :',
        ],
        'es' => [
            'signin.subject' => 'Tu código de FitPal Coach: :code',
            'signin.heading' => ':code',
            'hello' => 'Hola :name:',
            'hello.anon' => 'Hola:',
            'signin.body' => 'Introduce este código para entrar en FitPal Coach, o usa el botón de abajo. Cualquiera de los dos funciona una sola vez, durante 15 minutos.',
            'signin.button' => 'Entrar',
            'signin.footer' => '¿No lo has pedido? Ignora este mensaje: nadie puede entrar sin este código.',
            'confirm.subject' => 'Confirma tu nuevo correo de FitPal Coach',
            'confirm.heading' => 'Confirma tu nueva dirección',
            'confirm.body' => 'Abre este enlace para que :email sea tu dirección de acceso a FitPal Coach. Funciona una sola vez, durante 15 minutos.',
            'confirm.button' => 'Confirmar esta dirección',
            'confirm.footer' => '¿No lo has pedido? Ignora este mensaje: tu dirección de acceso no cambia.',
            'changed.subject' => 'Tu correo de acceso a FitPal Coach ha cambiado',
            'changed.heading' => 'Tu dirección de acceso ha cambiado',
            'changed.body' => 'Los enlaces de acceso de tu cuenta de FitPal Coach ahora se envían a :email en lugar de a esta dirección.',
            'changed.footer' => 'Si no has sido tú, responde a este mensaje para que bloqueemos la cuenta y lo arreglemos.',
            'joincode.subject' => 'Tu código de FitPal: :code',
            'joincode.heading' => ':code',
            'joincode.body' => 'Introduce este código para enviar tu solicitud a :coach. Sirve durante :minutes minutos.',
            'joincode.footer' => '¿No lo has pedido? Ignora este mensaje: no se envía nada sin este código.',
            'request.subject' => 'Nueva solicitud en FitPal Coach',
            'request.heading' => 'Alguien quiere entrenar contigo',
            'request.body' => 'Alguien ha pedido entrenar contigo desde tu página. Abre FitPal Coach para ver sus respuestas y aceptar o rechazar.',
            'request.button' => 'Ver mis solicitudes',
            'request.footer' => 'Recibes esto porque tu página está abierta. Ciérrala en Cuenta › Mi página para no recibir más solicitudes.',
            'joinyes.subject' => ':coach te ha aceptado en FitPal Coach',
            'joinyes.heading' => ':coach te ha aceptado',
            'joinyes.body' => 'Abre la página desde la que lo pediste, en el mismo móvil, para empezar a entrenar. Tu programa te espera en la app.',
            'joinyes.button' => 'Empezar a entrenar',
            'joinyes.footer' => 'Este enlace abre tu solicitud; solo inicia sesión en el móvil desde el que la hiciste.',
            'joinno.subject' => 'Tu solicitud a :coach',
            'joinno.heading' => 'Esta vez no',
            'joinno.body' => ':coach no puede aceptarte por ahora. No se guardó nada más que tu solicitud, que se borra en 30 días.',
            'joinno.footer' => 'Puedes volver a pedirlo más adelante desde su página.',
            'note.subject' => ':coach te ha respondido',
            'note.heading' => ':coach te ha respondido',
            'note.body' => 'Abre la aplicación para leer lo que :coach ha escrito sobre tu entrenamiento.',
            'note.button' => 'Abrir la aplicación',
            'note.footer' => 'Recibes como mucho uno de estos correos al día. Activa las notificaciones en la aplicación para enterarte antes.',
            'fallback' => '¿El botón no funciona? Copia este enlace en tu navegador:',
        ],
        'de' => [
            'signin.subject' => 'Dein Code für FitPal Coach: :code',
            'signin.heading' => ':code',
            'hello' => 'Hallo :name,',
            'hello.anon' => 'Hallo,',
            'signin.body' => 'gib diesen Code ein, um dich bei FitPal Coach anzumelden, oder nutze den Button unten. Beides funktioniert einmal, 15 Minuten lang.',
            'signin.button' => 'Anmelden',
            'signin.footer' => 'Nicht angefordert? Ignoriere diese Nachricht — ohne diesen Code kann sich niemand anmelden.',
            'confirm.subject' => 'Bestätige deine neue E-Mail-Adresse für FitPal Coach',
            'confirm.heading' => 'Bestätige deine neue Adresse',
            'confirm.body' => 'öffne diesen Link, um :email zu deiner Anmeldeadresse für FitPal Coach zu machen. Er funktioniert einmal, 15 Minuten lang.',
            'confirm.button' => 'Diese Adresse bestätigen',
            'confirm.footer' => 'Nicht angefordert? Ignoriere diese Nachricht — deine Anmeldeadresse bleibt, wie sie ist.',
            'changed.subject' => 'Deine Anmelde-E-Mail für FitPal Coach wurde geändert',
            'changed.heading' => 'Deine Anmeldeadresse wurde geändert',
            'changed.body' => 'Anmeldelinks für dein FitPal-Coach-Konto gehen jetzt an :email statt an diese Adresse.',
            'changed.footer' => 'Warst du das nicht? Antworte auf diese Nachricht, damit wir das Konto sperren und es in Ordnung bringen.',
            'joincode.subject' => 'Dein FitPal-Code: :code',
            'joincode.heading' => ':code',
            'joincode.body' => 'Gib diesen Code ein, um deine Anfrage an :coach zu senden. Er gilt :minutes Minuten.',
            'joincode.footer' => 'Nicht angefordert? Ignoriere diese Nachricht — ohne diesen Code wird nichts gesendet.',
            'request.subject' => 'Neue Anfrage bei FitPal Coach',
            'request.heading' => 'Jemand möchte mit dir trainieren',
            'request.body' => 'Jemand hat über deine Seite angefragt, mit dir zu trainieren. Öffne FitPal Coach, um die Antworten zu sehen und anzunehmen oder abzulehnen.',
            'request.button' => 'Meine Anfragen öffnen',
            'request.footer' => 'Du bekommst das, weil deine Seite offen ist. Schließe sie unter Konto › Meine Seite, um keine neuen Anfragen zu bekommen.',
            'joinyes.subject' => ':coach hat dich bei FitPal Coach angenommen',
            'joinyes.heading' => ':coach hat dich angenommen',
            'joinyes.body' => 'Öffne die Seite, von der du angefragt hast, auf demselben Handy, um loszulegen. Dein Programm wartet in der App.',
            'joinyes.button' => 'Mit dem Training starten',
            'joinyes.footer' => 'Dieser Link öffnet deine Anfrage; er meldet dich nur auf dem Handy an, von dem du angefragt hast.',
            'joinno.subject' => 'Deine Anfrage an :coach',
            'joinno.heading' => 'Diesmal nicht',
            'joinno.body' => ':coach kann dich gerade nicht aufnehmen. Außer deiner Anfrage wurde nichts gespeichert, und sie wird in 30 Tagen gelöscht.',
            'joinno.footer' => 'Du kannst später über die Seite erneut anfragen.',
            'note.subject' => ':coach hat dir geantwortet',
            'note.heading' => ':coach hat dir geantwortet',
            'note.body' => 'öffne die App, um zu lesen, was :coach zu deinem Training geschrieben hat.',
            'note.button' => 'App öffnen',
            'note.footer' => 'Du bekommst höchstens eine solche E-Mail pro Tag. Schalte in der App Benachrichtigungen ein, um es früher zu erfahren.',
            'fallback' => 'Der Button funktioniert nicht? Kopiere diesen Link in deinen Browser:',
        ],
    ];

    public static function langFor(User $user): string
    {
        $lang = MemberCard::lang($user->id);

        return in_array($lang, self::LANGS, true) ? $lang : 'en';
    }

    /**
     * The words for $lang, :email filled in, and the greeting. The name is whatever the account typed
     * at sign-up, so it greets only the address the account has already proven: the sign-in link and
     * the notice to the old address. A `confirm` mail goes to an address nobody has proven yet (a
     * self-serve sign-up can name anyone's), so it greets no one, and a name cannot pose as the mail's
     * own words in someone else's inbox.
     */
    public static function words(string $lang, string $kind, array $fill): array
    {
        $copy = self::COPY[$lang] ?? self::COPY['en'];
        // A join code (CHW-336) goes to an address nobody has proven either, typed by a stranger.
        $unproven = in_array($kind, ['confirm', 'joincode', 'joinyes', 'joinno'], true);
        $name = $unproven ? '' : trim((string) preg_replace('/\s+/u', ' ', (string) ($fill['name'] ?? '')));
        $out = ['fallback' => $copy['fallback'], 'hello' => $name === '' ? $copy['hello.anon'] : strtr($copy['hello'], [':name' => $name])];
        $values = [':email' => $fill['email'] ?? '', ':code' => $fill['code'] ?? '', ':coach' => $fill['coach'] ?? '', ':minutes' => (string) ($fill['minutes'] ?? '')];
        foreach (['subject', 'heading', 'body', 'button', 'footer'] as $part) {
            if (isset($copy["{$kind}.{$part}"])) {
                $out[$part] = strtr($copy["{$kind}.{$part}"], $values);
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
