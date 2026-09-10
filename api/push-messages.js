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
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano — vamos treinar 💪',
    checkinTitle: 'Check-in semanal 📋',
    checkinBody: 'Cinco escalas rápidas e o que seu treinador precisa saber.',
  },
};

// de/es/fr carry ONLY the check-in strings. This fork ships en/de/es/fr (CLAUDE.md) while these
// messages still carry upstream's en + pt-BR, so the rest-timer and workout-reminder copy reaches
// a German member in English — pre-existing, and its own change to make. New copy had no excuse
// for repeating it, so the entries below are partial on purpose: copyFor falls through to English
// per KEY, not per language, which is what lets them be added one at a time.
COPY.de = { checkinTitle: 'Wöchentliches Check-in 📋', checkinBody: 'Fünf kurze Skalen und alles, was dein Coach wissen sollte.' };
COPY.es = { checkinTitle: 'Check-in semanal 📋', checkinBody: 'Cinco escalas rápidas y lo que tu entrenador deba saber.' };
COPY.fr = { checkinTitle: 'Point hebdomadaire 📋', checkinBody: 'Cinq échelles rapides et ce que votre coach doit savoir.' };

// Per KEY, not per language: a language block that carries only some of the strings falls back to
// English for the rest instead of losing them.
const copyFor = lang => ({ ...COPY.en, ...(COPY[lang] || {}) });

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'openGym', body: copyFor(lang).testBody, tag: 'test' };
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
