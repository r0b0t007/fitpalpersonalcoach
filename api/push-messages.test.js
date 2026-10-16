import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assignmentPush, checkinReminderPush, dayReminderPush, restTimerPush, testPush, PUSH_LANGS,
} from './push-messages.js';

// Every message, for a member of each language, with the copy it should carry.
const all = lang => ({
  rest: restTimerPush(lang),
  test: testPush(lang, 'FitPal Coach'),
  day: dayReminderPush(lang, { name: 'Push', emoji: '💪' }),
  dayFallback: dayReminderPush(lang, null),
  checkin: checkinReminderPush(lang),
  assignment: assignmentPush(lang, 'Sam', 'FitPal Coach'),
});

test('every language the app ships has push copy, and every message in it', () => {
  // LANGS lives in the frontend, which the api cannot import; read it as text, the way
  // scripts/check-adherence-window.mjs reads across the same boundary.
  const src = readFileSync(new URL('../frontend/src/lib/i18n-core.js', import.meta.url), 'utf8');
  const block = src.match(/export const LANGS = \{([\s\S]*?)\}/);
  assert.ok(block, 'LANGS not found in frontend/src/lib/i18n-core.js — was it renamed?');
  const shipped = [...block[1].matchAll(/(?:^|[\s,{])'?([a-z]{2}(?:-[A-Z]{2})?)'?\s*:/g)].map(m => m[1]).sort();
  assert.deepEqual([...PUSH_LANGS].sort(), shipped);

  // copyFor falls back to English per key, so a missing translation would arrive as English
  // rather than fail anywhere. Comparing each language's output to English finds it.
  const en = all('en');
  for (const lang of PUSH_LANGS.filter(l => l !== 'en')) {
    const out = all(lang);
    for (const [k, v] of Object.entries(out)) {
      if (k === 'test') assert.equal(v.title, 'FitPal Coach');
      assert.notEqual(v.body, en[k].body, `${lang} ${k} body is the English one`);
    }
    assert.notEqual(out.rest.title, en.rest.title, `${lang} rest title is the English one`);
    assert.notEqual(out.checkin.title, en.checkin.title, `${lang} check-in title is the English one`);
    assert.notEqual(out.dayFallback.title, en.dayFallback.title, `${lang} day title is the English one`);
  }
});

test('French says "vous", like the rest of the app', () => {
  const fr = all('fr');
  assert.deepEqual(fr.rest, { title: 'Repos terminé 💪', body: 'C’est l’heure de votre prochaine série.', tag: 'rest-timer' });
  assert.equal(fr.day.title, '💪 Push aujourd’hui');
  assert.equal(fr.assignment.body, 'Sam vous a envoyé un programme');
  for (const m of Object.values(fr)) assert.doesNotMatch(m.title + ' ' + m.body, /(?<![\p{L}])(tu|ton|ta|tes|te|toi)(?![\p{L}])/iu);
});

test('the program push is in the member\'s language and names the coach as typed', () => {
  assert.deepEqual(assignmentPush('es', 'Ana', 'FitPal Coach'),
    { title: 'FitPal Coach', body: 'Ana te ha enviado un programa', tag: 'assignment' });
  // A replacement function, not a string: "$&" in a name is text, not a pattern.
  assert.equal(assignmentPush('en', 'A$&B').body, 'A$&B sent you a program');
});

test('an unknown language falls back to English', () => {
  assert.deepEqual(restTimerPush('is'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ — this is what alerts look like.');
  assert.equal(testPush('en').title, 'openGym');
});

test('the check-in nudge replaces rather than stacks', () => {
  // The tag is the point as much as the copy: same tag means the device REPLACES the previous
  // nudge instead of stacking, so a phone left in a drawer shows one, not four. And it must not
  // collide with the workout reminder, or the two would overwrite each other.
  assert.equal(checkinReminderPush('de').title, 'Wöchentliches Check-in 📋');
  assert.notEqual(checkinReminderPush('en').tag, dayReminderPush('en', null).tag);
});
