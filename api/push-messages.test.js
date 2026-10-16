import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COPY, PUSH_LANGS, assignmentPush, checkinReminderPush, dayReminderPush, restTimerPush, testPush,
} from './push-messages.js';
import { tuPronouns } from '../scripts/french-vous.mjs';

// The frontend's own packs, read across the api/frontend boundary the way
// scripts/check-adherence-window.mjs does: the api cannot import the app, but its tests can read it.
const pack = async lang => (await import(new URL(`../frontend/src/locales/${lang}.js`, import.meta.url))).default;

test('every language the app ships has push copy', () => {
  const src = readFileSync(new URL('../frontend/src/lib/i18n-core.js', import.meta.url), 'utf8');
  const block = src.match(/export const LANGS = \{([\s\S]*?)\}/);
  assert.ok(block, 'LANGS not found in frontend/src/lib/i18n-core.js — was it renamed?');
  // Any key, quoted or not, not only two-letter codes: 'zh-Hant' or fil must not slip through.
  const shipped = [...block[1].matchAll(/(?:^|[\s,{])(['"]?)([A-Za-z][\w-]*)\1\s*:/g)].map(m => m[2]).sort();
  assert.ok(shipped.includes('en') && shipped.length > 1, `could not read LANGS: ${shipped}`);
  assert.deepEqual([...PUSH_LANGS].sort(), shipped);
});

test('every language has every message English has, and nothing else', () => {
  // copyFor falls back to English per key, so a missing translation would arrive as English
  // rather than fail anywhere. This is what catches it — by key, not by output, so a message no
  // builder exposes yet is covered too, and a translation that happens to equal English is fine.
  const keys = Object.keys(COPY.en).sort();
  for (const lang of PUSH_LANGS) {
    assert.deepEqual(Object.keys(COPY[lang]).sort(), keys, `${lang} is missing or adds a key`);
    for (const k of keys) assert.ok(String(COPY[lang][k]).trim(), `${lang}.${k} is empty`);
    assert.ok(COPY[lang].assignmentBody.includes('{0}'), `${lang}.assignmentBody lost the coach's name`);
  }
});

test('a push says what the app says, where both show the same thing', async () => {
  // The program notice and the check-in card are in the app too. Fix the wording in one place
  // only, and the lock screen and the app would describe the same event differently.
  for (const lang of PUSH_LANGS.filter(l => l !== 'en')) {
    const p = await pack(lang), c = COPY[lang];
    assert.equal(c.assignmentBody, p['{0} sent you a program'], `${lang}: program notice`);
    assert.equal(c.checkinBody, p['Five quick scales and anything your coach should know.'], `${lang}: check-in body`);
    assert.equal(c.checkinTitle, p['Weekly check-in'] + ' 📋', `${lang}: check-in title`);
  }
});

test('French says "vous", like the rest of the app', () => {
  for (const [k, v] of Object.entries(COPY.fr)) assert.deepEqual(tuPronouns(v), [], `fr.${k}: ${v}`);
  assert.deepEqual(restTimerPush('fr'), { title: 'Repos terminé 💪', body: 'C’est l’heure de votre prochaine série.', tag: 'rest-timer' });
  assert.equal(dayReminderPush('fr', { name: 'Push', emoji: '💪' }).title, '💪 Push aujourd’hui');
});

test('the program push is in the member\'s language and names the coach as typed', () => {
  assert.deepEqual(assignmentPush('es', 'Ana', 'FitPal Coach'),
    { title: 'FitPal Coach', body: 'Ana te ha enviado un programa', tag: 'assignment' });
  // A replacement function, not a string: "$&" in a name is text, not a pattern.
  assert.equal(assignmentPush('en', 'A$&B', 'FitPal Coach').body, 'A$&B sent you a program');
});

test('the test push carries the server\'s name, and an unknown language falls back to English', () => {
  assert.equal(testPush('fr', 'FitPal Coach').title, 'FitPal Coach');
  assert.deepEqual(restTimerPush('is'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined, 'X').body, 'Test notification ✅ — this is what alerts look like.');
});

test('the check-in nudge replaces rather than stacks', () => {
  // The tag is the point as much as the copy: same tag means the device REPLACES the previous
  // nudge instead of stacking, so a phone left in a drawer shows one, not four. And it must not
  // collide with the workout reminder, or the two would overwrite each other.
  assert.notEqual(checkinReminderPush('en').tag, dayReminderPush('en', null).tag);
});
