#!/usr/bin/env node
/* Does the API still send enough days for the client's adherence window?
 *
 * Two constants on opposite sides of a boundary neither side can import across:
 *
 *   api/server.js                    ADHERENCE_SEND_DAYS   — how much history the roster ships
 *   frontend/src/lib/adherence.js    ADHERENCE_WINDOW_DAYS — how much of it the client scores
 *
 * The API must send at least one day MORE than the client scores, because the trim runs on the
 * server's UTC date and the window on the viewer's local one; they differ by up to a day.
 *
 * Getting it wrong is silent in the worst way. A date the server trimmed away is indistinguishable
 * from a date the member did not train on, so raising the client's window without raising the
 * server's does not error — every member's adherence simply drops, by a different amount depending
 * on which side of UTC the coach happens to be sitting.
 *
 * Read as text on purpose: api/ cannot import from frontend/ (different package, different build),
 * and a shared module for two integers would be a heavier coupling than the one it replaced.
 */
import { readFileSync } from 'node:fs';

const read = (path, name) => {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const m = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  if (!m) {
    console.error(`FAIL  could not find ${name} in ${path} — was it renamed?`);
    process.exit(1);
  }
  return Number(m[1]);
};

const send = read('../server.js', 'ADHERENCE_SEND_DAYS');
const scored = read('../../frontend/src/lib/adherence.js', 'ADHERENCE_WINDOW_DAYS');

if (send < scored + 1) {
  console.error(`FAIL  the API sends ${send} days but the client scores ${scored}.`);
  console.error(`      ADHERENCE_SEND_DAYS must be at least ${scored + 1}: the trim runs on the`);
  console.error("      server's UTC date and the window on the viewer's local one, so a coach west");
  console.error('      of UTC would lose the oldest day of their own window — silently, because a');
  console.error('      trimmed date reads as "did not train" rather than as missing data.');
  process.exit(1);
}
console.log(`ok    API sends ${send} days, client scores ${scored}`);
