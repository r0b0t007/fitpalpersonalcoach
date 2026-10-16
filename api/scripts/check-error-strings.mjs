#!/usr/bin/env node
/* Can the app say every refusal this API sends in the user's language?
 *
 * The server refuses in English ("challenge expired — try again"), and English is also the
 * translation key, so the app translates what arrives (frontend/src/lib/server-messages.js).
 * That only works if every message is a key in every pack, and nothing else notices when one is
 * not: the user just reads English at sign-in, on an invite, or when sync fails.
 *
 * A message with a value in it ("that exercise already has 6 videos") cannot be a key as sent.
 * It is written as a `say` template on the server, its key is the template with each ${…} as
 * {0}, {1}…, and the app finds it by matching against SERVER_TEMPLATES. So this checks three
 * things:
 *
 *   1. every `error: '…'` literal, and every say('…') / say`…`, in the files below is a key in
 *      every locale pack;
 *   2. SERVER_TEMPLATES is exactly the set of say`…` templates — one missing is a message the
 *      app cannot match, one extra is dead;
 *   3. no refusal is built some other way (`error: \`…\``, `error: '…' + x`), which would slip
 *      past 1 and 2 without failing anything.
 *
 * Read as text, like check-adherence-window.mjs: api/ cannot import from frontend/.
 */
import { readFileSync } from 'node:fs';

const FILES = ['../server.js', '../domain.mjs', '../verify-error.js'];
const LOCALES = ['de', 'es', 'fr'];
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

const unq = s => s.replace(/\\(.)/g, '$1');
const STR = String.raw`'((?:\\.|[^'\\\n])*)'`;
const statics = new Map();     // message -> first file it was seen in
const templates = new Map();
const bad = [];

for (const f of FILES) {
  const src = read(f);
  for (const m of src.matchAll(new RegExp(String.raw`\berror:\s*` + STR, 'g'))) statics.set(unq(m[1]), f);
  for (const m of src.matchAll(new RegExp(String.raw`\bsay\(\s*` + STR + String.raw`\s*\)`, 'g'))) statics.set(unq(m[1]), f);
  for (const m of src.matchAll(/\bsay`((?:\\.|[^`\\])*)`/g)) {
    let i = 0;
    templates.set(unq(m[1].replace(/\$\{[^}]*\}/g, () => `{${i++}}`)), f);
  }
  src.split('\n').forEach((line, n) => {
    if (/\berror:\s*`/.test(line) || new RegExp(String.raw`\berror:\s*` + STR + String.raw`\s*\+`).test(line))
      bad.push(`${f.slice(3)}:${n + 1}  ${line.trim()}`);
  });
}

let failed = false;
if (bad.length) {
  failed = true;
  console.error('FAIL  refusals built outside say`…` — the app cannot translate these:');
  for (const b of bad) console.error('      ' + b);
}

const packs = await Promise.all(LOCALES.map(async l =>
  [l, (await import(new URL(`../../frontend/src/locales/${l}.js`, import.meta.url))).default]));
const all = new Map([...statics, ...templates]);
for (const [l, pack] of packs) {
  const missing = [...all.keys()].filter(k => !(k in pack));
  if (missing.length) {
    failed = true;
    console.error(`FAIL  ${l}.js has no translation for ${missing.length} server message(s):`);
    for (const k of missing) console.error(`      ${JSON.stringify(k)}  (${all.get(k).slice(3)})`);
  }
}

const listed = new Set(JSON.parse(
  read('../../frontend/src/lib/server-messages.js').match(/SERVER_TEMPLATES = (\[[\s\S]*?\])/)?.[1] ?? 'null') || []);
const unlisted = [...templates.keys()].filter(k => !listed.has(k));
const dead = [...listed].filter(k => !templates.has(k));
if (unlisted.length || dead.length) {
  failed = true;
  console.error('FAIL  SERVER_TEMPLATES in frontend/src/lib/server-messages.js is out of step with the API:');
  for (const k of unlisted) console.error(`      missing: ${JSON.stringify(k)}`);
  for (const k of dead) console.error(`      no longer sent: ${JSON.stringify(k)}`);
}

if (failed) process.exit(1);
console.log(`ok    ${statics.size} server messages and ${templates.size} templates, all translated`);
