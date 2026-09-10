#!/usr/bin/env node
// Every event name api/server.js can write to the audit log must have a human label in
// frontend/src/lib/audit.js, or the admin dashboard prints a dotted identifier at a person.
//
// frontend/src/lib/audit.test.js already claims to guard this — its header says "if a new one is
// added there without a label here, the first test fails rather than the dashboard quietly
// printing a dotted identifier". It cannot: its EVENTS list is a hand-typed COPY of the names in
// server.js, so it only ever tests the names somebody remembered to copy. By the time this script
// was written the copy had been stale long enough that THREE events — auth.pair.create,
// auth.pair.fail and auth.pair.ok — had been shipping unlabelled, and nothing had gone red.
//
// Same shape as check-adherence-window.mjs: two values either side of a boundary neither can
// import across, so a script reads both files rather than a test importing one of them.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Every .js under api/, not just server.js. The first version read one file, which would have gone
// green forever the day an audit() call appeared in api/coach/ — and the count check below could
// not have noticed, because server.js alone clears any floor. node_modules and the built deploy
// bundle are skipped: the bundle is a COPY of these files, so counting it would double every
// event and could mask a real one going missing.
const SKIP = new Set(['node_modules', 'deploy', 'test', 'scripts'])
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (e.name.startsWith('.') || SKIP.has(e.name)) return []
  const full = join(dir, e.name)
  return e.isDirectory() ? walk(full) : (/\.(js|mjs)$/.test(e.name) ? [full] : [])
})
const server = walk(join(root, 'api')).map(f => readFileSync(f, 'utf8')).join('\n')
const audit = readFileSync(join(root, 'frontend', 'src', 'lib', 'audit.js'), 'utf8')

// Every audit() call site passes a literal — including the one ternary, which is why this pulls
// ALL dotted literals out of the call rather than just the second argument. Verified at the time
// of writing that no call site passes a variable; the self-check below is what notices if that
// ever stops being true, since a dynamic name would silently shrink this set to nothing.
const emitted = new Set()
// Balanced to the closing paren, not to `);`. The first version required the call to end in `);`
// with no semicolon anywhere inside it, so an argument containing one would have been dropped
// silently. This still cannot parse JS — the floor below is the backstop, not this regex.
for (const call of server.matchAll(/\baudit\(\s*[A-Za-z_$][\w$]*\s*,((?:[^()]|\([^()]*\))*)\)/gs))
  for (const lit of call[1].matchAll(/'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'/g)) emitted.add(lit[1])

const labelled = new Set()
const block = audit.match(/const LABELS\s*=\s*\{([\s\S]*?)\n\}/)
if (block) for (const k of block[1].matchAll(/'([^']+)'\s*:/g)) labelled.add(k[1])

// Self-check first. A regex that matches nothing is indistinguishable from a clean run, which is
// how a guard rots into decoration — the same failure this script exists to correct.
const fail = m => { console.error('FAIL  ' + m); process.exitCode = 1 }
// A floor committed at the count on the day this was written, not a token minimum: `5` is cleared
// by server.js alone forever, which is the shape of a self-check that never fires. Raise it
// deliberately when events are added. A DROP means the extractor stopped seeing calls that are
// still there — the exact rot this script exists to avoid becoming.
const FLOOR = 18
if (emitted.size < FLOOR) fail(`found ${emitted.size} audit events across api/, expected at least ${FLOOR} — the extractor is broken, not the code`)
if (labelled.size < FLOOR) fail(`found ${labelled.size} labels in audit.js, expected at least ${FLOOR} — the extractor is broken, not the code`)


const missing = [...emitted].filter(e => !labelled.has(e)).sort()
if (missing.length) {
  fail(`${missing.length} audit event(s) the server emits have no label in frontend/src/lib/audit.js:`)
  for (const m of missing) console.error(`        ${m}`)
  console.error('      The admin activity log would print these raw. Add them to LABELS.')
}

// Not an error: a label for an event nothing emits any more is harmless, and deleting it would
// break the history already written to data/audit.log.
const orphan = [...labelled].filter(l => !emitted.has(l)).sort()

if (!process.exitCode)
  console.log(`OK    ${emitted.size} audit events, all labelled` + (orphan.length ? ` (${orphan.length} label(s) for events no longer emitted: ${orphan.join(', ')})` : ''))
