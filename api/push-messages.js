// Every push the server writes, in each language the app ships (LANGS in
// frontend/src/lib/i18n-core.js; push-messages.test.js holds the two lists together). The server
// picks the language from the member's synced S.lang. French says "vous", like the rest of the app.
const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ — this is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan — let's go 💪",
    checkinTitle: 'Weekly check-in 📋',
    checkinBody: 'Five quick scales and anything your coach should know.',
    assignmentBody: '{0} sent you a program',
  },
  de: {
    restTitle: 'Pause vorbei 💪',
    restBody: 'Zeit für deinen nächsten Satz.',
    testBody: 'Testbenachrichtigung ✅ — so sehen Hinweise aus.',
    dayFallbackTitle: 'Heute steht ein Training an',
    dayRoutineSuffix: 'heute',
    dayBody: 'Es steht in deinem Plan — los geht’s 💪',
    checkinTitle: 'Wöchentliches Check-in 📋',
    checkinBody: 'Fünf kurze Skalen und alles, was dein Coach wissen sollte.',
    assignmentBody: '{0} hat dir ein Programm geschickt',
  },
  es: {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora de tu siguiente serie.',
    testBody: 'Notificación de prueba ✅ — así se ven los avisos.',
    dayFallbackTitle: 'Entrenamiento previsto para hoy',
    dayRoutineSuffix: 'hoy',
    dayBody: 'Está en tu plan — ¡vamos! 💪',
    checkinTitle: 'Check-in semanal 📋',
    checkinBody: 'Cinco escalas rápidas y lo que tu entrenador deba saber.',
    assignmentBody: '{0} te ha enviado un programa',
  },
  fr: {
    restTitle: 'Repos terminé 💪',
    restBody: 'C’est l’heure de votre prochaine série.',
    testBody: 'Notification de test ✅ — voici à quoi ressemblent les alertes.',
    dayFallbackTitle: 'Séance prévue aujourd’hui',
    dayRoutineSuffix: 'aujourd’hui',
    dayBody: 'Elle est dans votre plan — c’est parti 💪',
    checkinTitle: 'Point hebdomadaire 📋',
    checkinBody: 'Cinq échelles rapides et ce que votre coach doit savoir.',
    assignmentBody: '{0} vous a envoyé un programme',
  },
};
export const PUSH_LANGS = Object.keys(COPY);

// Per KEY, not per language: a message added to English but not yet translated arrives in English
// instead of as "undefined". push-messages.test.js fails on that gap, so it is a fallback for an
// unknown language, not a way to ship one half done.
const copyFor = lang => ({ ...COPY.en, ...(COPY[lang] || {}) });

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

// `appName` is RP_NAME — what this server calls itself — so the test looks like a real alert.
export function testPush(lang, appName = 'openGym') {
  return { title: appName, body: copyFor(lang).testBody, tag: 'test' };
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? `${routine.emoji || '🏋️'} ${routine.name} ${copy.dayRoutineSuffix}`
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  };
}

// Once a week, on the member's check-in day. `tag` matters as much as the copy: a push with the
// same tag REPLACES the one before it on the device rather than stacking, so a member who left
// their phone in a drawer comes back to one check-in nudge and not four.
export function checkinReminderPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.checkinTitle, body: copy.checkinBody, tag: 'checkin-reminder' };
}

// A coach sent this member a program. In the MEMBER's language — the coach's is irrelevant here.
export function assignmentPush(lang, coachName, appName = 'openGym') {
  return { title: appName, body: copyFor(lang).assignmentBody.replace('{0}', () => coachName), tag: 'assignment' };
}
