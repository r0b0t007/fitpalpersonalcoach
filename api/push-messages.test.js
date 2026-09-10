import test from 'node:test';
import assert from 'node:assert/strict';
import { checkinReminderPush, dayReminderPush, restTimerPush, testPush } from './push-messages.js';

test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Descanso terminado 💪',
    body: 'Hora da próxima série.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('pt-BR'), {
    title: 'openGym',
    body: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A hoje',
    body: 'Está no seu plano — vamos treinar 💪',
    tag: 'day-reminder',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('fr'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ — this is what alerts look like.');
});

test('the check-in nudge is localized and replaces rather than stacks', () => {
  assert.deepEqual(checkinReminderPush('pt-BR'), {
    title: 'Check-in semanal 📋',
    body: 'Cinco escalas rápidas e o que seu treinador precisa saber.',
    tag: 'checkin-reminder',
  });
  assert.equal(checkinReminderPush('de').title, 'Wöchentliches Check-in 📋');
  assert.equal(checkinReminderPush('fr').body, 'Cinq échelles rapides et ce que votre coach doit savoir.');
  // A genuinely unknown language falls back to English rather than rendering "undefined". 'de'
  // used to be the example here, which quietly encoded the missing translation as intended.
  assert.equal(checkinReminderPush('is').title, 'Weekly check-in 📋');
  // de/es/fr carry only the check-in strings, so the fallback has to work per KEY, not per
  // language — otherwise adding one string to a language would blank the others.
  assert.equal(restTimerPush('de').title, 'Rest over 💪');
  // The tag is the point as much as the copy: same tag means the device REPLACES the previous
  // nudge instead of stacking, so a phone left in a drawer shows one, not four. And it must not
  // collide with the workout reminder, or the two would overwrite each other.
  assert.notEqual(checkinReminderPush('en').tag, dayReminderPush('en', null).tag);
});
