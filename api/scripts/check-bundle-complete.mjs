#!/usr/bin/env node
/* Does the deploy bundle contain every file server.js actually imports?
 *
 * The bundle used to be an explicit `cp` list, and twice a new runtime module was added to the
 * repo without being added to that list: the container crashed on domain.mjs, and coach.fitpal.ma
 * served a 503 for `./coach/config.js`. Both passed CI, because CI runs from the repo where the
 * file is right there. The bundle is the only place the omission exists, so it is the only place
 * worth checking.
 *
 * Walks every relative import reachable from the entry point and asserts it resolves *inside*
 * the bundle. Bare specifiers are left to node_modules and node's own builtins. Escaping the
 * bundle root fails too: on the runner `deploy/../api/x.js` is a real file sitting next to the
 * bundle, while on the server the same specifier lands in the cPanel home — a pass here and a
 * dead app there.
 *
 * Known blind spot: only quoted static specifiers are seen. A template-literal dynamic import
 * (import(`./adapters/${name}.js`)) is invisible to the walk, so a green result is a proof about
 * the static graph, not a proof that nothing at all is missing. Keep the runtime graph static.
 *
 *   node scripts/check-bundle-complete.mjs <bundle-dir> [entry]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const entry = resolve(root, process.argv[3] || 'server.js');

// Matches `from './x'`, `import './x'`, `import('./x')` and `require('./x')` — single or double
// quoted. `from` is anchored so a `Foo.from('./x')` call cannot masquerade as an import and fail
// a deploy over nothing; `require\w*` catches the createRequire aliases the coach adapters use.
const SPEC = /(?:(?<![.\w])from|\bimport|\brequire\w*)\s*\(?\s*['"](\.[^'"]*)['"]/g;

const seen = new Set();
const missing = [];
const escaped = [];

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!existsSync(file) || !statSync(file).isFile()) return;
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(SPEC)) {
    const target = resolve(dirname(file), spec);
    // Outside the bundle is as broken as absent, and harder to see: it only looks fine because
    // the runner has a whole repo around the bundle where the server has a bare app root.
    if (relative(root, target).startsWith('..')) {
      escaped.push(`${relative(root, file)} -> ${spec}`);
      continue;
    }
    if (!existsSync(target)) {
      missing.push(`${relative(root, file)} -> ${spec}`);
      continue;
    }
    if (/\.m?js$/.test(target)) walk(target);
  }
}

if (!existsSync(entry)) {
  console.error(`FAIL  entry point missing from the bundle: ${relative(root, entry)}`);
  process.exit(1);
}
walk(entry);

if (missing.length) {
  console.error(`FAIL  ${missing.length} import(s) do not exist in the bundle:`);
  for (const m of missing) console.error(`        ${m}`);
  console.error('\n      Add the file to the bundle step in .github/workflows/deploy-api.yml.');
}
if (escaped.length) {
  console.error(`FAIL  ${escaped.length} import(s) reach outside the bundle root:`);
  for (const m of escaped) console.error(`        ${m}`);
  console.error('\n      These resolve on the runner and not on the server. Move the file in.');
}
if (missing.length || escaped.length) process.exit(1);

console.log(`ok    ${seen.size} module(s) reachable from ${relative(root, entry)}, all present`);
