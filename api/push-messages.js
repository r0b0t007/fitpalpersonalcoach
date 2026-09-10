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

const copyFor = lang => COPY[lang] || COPY.en;

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
