#!/usr/bin/env node
/* Can the app say every refusal this API sends in the user's language?
 *
 * The server refuses in English ("challenge expired — try again"), English is also the
 * translation key, and the app translates what arrives (frontend/src/lib/server-messages.js).
 * That only works if every message is a key in every pack, and nothing else notices when one is
 * not: the user just reads English at sign-in, on an invite, or when sync fails.
 *
 * A message with a value in it ("that exercise already has 6 videos") is written as a say`…`
 * template, and the server sends its key ("that exercise already has {0} videos") and values
 * beside the text. So this checks:
 *
 *   1. every `error: '…'` literal, every say('…') and every say`…` template (as its key) in the
 *      files below is a key in every locale pack;
 *   2. no message is built in a way 1 cannot see. This is a list of the shapes that have been
 *      used, not a proof: an error field set from a template literal, a double-quoted string or
 *      a concatenation; fail(status, …) or new Error(…) given a bare template literal, string
 *      literal or concatenation. A line can opt out with a `// not sent:` comment saying why.
 *      A helper that returns a plain string literal for a caller to send is NOT caught — wrap it
 *      in say('…'), as pushEndpointError does.
 *
 * Read as text, like check-adherence-window.mjs: api/ cannot import from frontend/.
 */
import { readFileSync } from 'node:fs';

const FILES = ['../server.js', '../domain.mjs', '../verify-error.js'];
const LOCALES = ['de', 'es', 'fr'];
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

const unq = s => s.replace(/\\(.)/g, '$1');
const STR = String.raw`'((?:\\.|[^'\\\n])*)'`;
const keys = new Map();     // key -> file it was first seen in
const bad = [];

// A message handed over unmarked: a template literal, a double-quoted string, or a string
// literal / identifier followed by +.
const RAW = String.raw`(?:` + '`' + String.raw`|"|'(?:\\.|[^'\\\n])*'\s*\+|[\w.]+\s*\+)`;
const SHAPES = [
  new RegExp(String.raw`\berror:\s*` + RAW),
  new RegExp(String.raw`\bfail\(\s*\d+\s*,\s*(?:` + RAW + '|' + STR + String.raw`\s*\))`),
  new RegExp(String.raw`\bnew Error\(\s*(?:` + RAW + '|' + STR + String.raw`\s*\))`),
];

for (const f of FILES) {
  const src = read(f);
  for (const m of src.matchAll(new RegExp(String.raw`\berror:\s*` + STR, 'g'))) keys.set(unq(m[1]), f);
  for (const m of src.matchAll(new RegExp(String.raw`\bsay\(\s*` + STR + String.raw`\s*\)`, 'g'))) keys.set(unq(m[1]), f);
  for (const m of src.matchAll(/\bsay`((?:\\.|[^`\\])*)`/g)) {
    let i = 0;
    keys.set(unq(m[1].replace(/\$\{[^}]*\}/g, () => `{${i++}}`)), f);
  }
  src.split('\n').forEach((line, n) => {
    const code = line.replace(/^\s*(\/\/|\/\*|\*).*$/, '');   // a comment line describes, it does not send
    if (/\/\/ not sent:/.test(code)) return;
    if (SHAPES.some(re => re.test(code))) bad.push(`${f.slice(3)}:${n + 1}  ${line.trim()}`);
  });
}

let failed = false;
if (bad.length) {
  failed = true;
  console.error('FAIL  messages built outside say — the app cannot translate these:');
  for (const b of bad) console.error('      ' + b);
}

const packs = await Promise.all(LOCALES.map(async l =>
  [l, (await import(new URL(`../../frontend/src/locales/${l}.js`, import.meta.url))).default]));
for (const [l, pack] of packs) {
  const missing = [...keys.keys()].filter(k => !(k in pack));
  if (missing.length) {
    failed = true;
    console.error(`FAIL  ${l}.js has no translation for ${missing.length} server message(s):`);
    for (const k of missing) console.error(`      ${JSON.stringify(k)}  (${keys.get(k).slice(3)})`);
  }
}

if (failed) process.exit(1);
console.log(`ok    ${keys.size} server messages, all translated`);
