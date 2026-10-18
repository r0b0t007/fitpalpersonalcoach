#!/usr/bin/env node
/* Can the app say every refusal the Laravel backend sends, in the user's language?
 *
 * The PHP side of api/scripts/check-error-strings.mjs, for the same reason: the API refuses in
 * English, English is the translation key, and the app translates what arrives
 * (frontend/src/lib/server-messages.js). A message missing from a pack reaches a French- or
 * Spanish-speaking coach as English, and nothing else notices.
 *
 * Checked:
 *   1. every message the backend can send — Json::error(status, '…'), new ClientSafe(status, '…')
 *      and every Say::f('…') template (sent as its key, with the values beside it) — is a key in
 *      every locale pack;
 *   2. no message is built in a way 1 cannot see: Json::error or ClientSafe given anything but a
 *      single-quoted literal or a Say::f()/helper call — a double-quoted string, a concatenation,
 *      a variable, a cast. A line can opt out with a `// relayed:` comment saying where its text
 *      IS checked (the ClientSafe renderer relays messages checked where they are thrown), or
 *      `// not sent:` saying why the app never needs it translated.
 *
 * Comment lines are skipped for both, so a docblock example is not mistaken for a message.
 * Read as text: backend/ cannot import from frontend/ (and this runs without PHP).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['app', 'bootstrap', 'routes'];
const LOCALES = ['de', 'es', 'fr'];

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const full = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'cache' ? [] : walk(full);
  return e.name.endsWith('.php') ? [full] : [];
});
const files = DIRS.flatMap(d => walk(join(backend, d)));

// A PHP single-quoted string: only \' and \\ are escapes.
const STR = String.raw`'((?:\\.|[^'\\])*)'`;
const unq = s => s.replace(/\\(['\\])/g, '$1');
// The status argument: a number, or an expression with empty-argument calls ($e->getStatusCode()).
const STATUS = String.raw`(?:[^,()]|\(\))+`;
const SENDERS = [
  new RegExp(String.raw`\bJson::error\(\s*` + STATUS + String.raw`,\s*` + STR, 'g'),
  new RegExp(String.raw`\bnew ClientSafe\(\s*` + STATUS + String.raw`,\s*` + STR, 'g'),
  new RegExp(String.raw`\bSay::f\(\s*` + STR, 'g'),
];
// A sender's message argument that is not one readable literal: "…", a variable, a cast, or a
// literal concatenated with something.
const OPAQUE = String.raw`(?:"|\$|\(string\)|'(?:\\.|[^'\\])*'\s*\.)`;
const SHAPES = [
  new RegExp(String.raw`\bJson::error\(\s*` + STATUS + String.raw`,\s*` + OPAQUE),
  new RegExp(String.raw`\bnew ClientSafe\(\s*` + STATUS + String.raw`,\s*` + OPAQUE),
];
const OPT_OUT = /\/\/ (?:not sent|relayed):/;

const keys = new Map();   // key -> file it was first seen in
const bad = [];
for (const f of files) {
  const rel = relative(backend, f).replaceAll('\\', '/');
  // Comment lines describe, they do not send.
  const lines = readFileSync(f, 'utf8').split('\n').map(l => l.replace(/^\s*(\/\/|\/\*|\*).*$/, ''));
  for (const re of SENDERS) for (const m of lines.join('\n').matchAll(re)) if (!keys.has(unq(m[1]))) keys.set(unq(m[1]), rel);
  lines.forEach((line, n) => {
    if (!OPT_OUT.test(line) && SHAPES.some(re => re.test(line))) bad.push(`${rel}:${n + 1}  ${line.trim()}`);
  });
}

let failed = false;
const fail = m => { failed = true; console.error('FAIL  ' + m); };

// Self-check: an extractor that matches nothing is indistinguishable from a clean run. 18 = the
// distinct messages the backend sent when this was written (CHW-240); raise it as routes are
// ported, and never lower it to make a red run green.
const FLOOR = 18;
if (keys.size < FLOOR) fail(`found ${keys.size} messages in backend/, expected at least ${FLOOR} — the extractor is broken, not the code`);

if (bad.length) {
  fail('messages built in a way this check cannot read — the app may not be able to translate them:');
  for (const b of bad) console.error('      ' + b);
}

const packs = await Promise.all(LOCALES.map(async l =>
  [l, (await import(new URL(`../../frontend/src/locales/${l}.js`, import.meta.url))).default]));
for (const [l, pack] of packs) {
  const missing = [...keys.keys()].filter(k => !(k in pack));
  if (missing.length) {
    fail(`${l}.js has no translation for ${missing.length} backend message(s):`);
    for (const k of missing) console.error(`      ${JSON.stringify(k)}  (${keys.get(k)})`);
  }
}

if (failed) process.exit(1);
console.log(`ok    ${keys.size} backend messages, all translated`);
