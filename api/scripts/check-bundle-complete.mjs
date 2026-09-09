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
 * the bundle. Bare specifiers are left to node_modules and node's own builtins.
 *
 *   node scripts/check-bundle-complete.mjs <bundle-dir> [entry]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const entry = resolve(root, process.argv[3] || 'server.js');

// Matches `from './x'`, `import './x'` and `import('./x')` — single or double quoted.
const SPEC = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.[^'"]*)['"]/g;

const seen = new Set();
const missing = [];

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!existsSync(file) || !statSync(file).isFile()) return;
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(SPEC)) {
    const target = resolve(dirname(file), spec);
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
  process.exit(1);
}
console.log(`ok    ${seen.size} module(s) reachable from ${relative(root, entry)}, all present`);
