#!/usr/bin/env node
// Every event the backend writes to the audit log must have a human label in
// frontend/src/lib/audit.js, or the admin activity log prints a dotted identifier at a person.
//
// frontend/src/lib/audit.test.js cannot guard this: its event list is a hand-typed copy, so it
// only ever tests the names somebody remembered to copy. Three auth.pair.* events once shipped
// unlabelled because of it. This reads both sides instead: backend/ cannot import from frontend/
// (and this runs without PHP).
//
// Moved here from api/scripts/ when the Node API was retired (CHW-301); it used to read both
// servers' events while both existed.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (e.name.startsWith('.') || e.name === 'vendor') return []
  const full = join(dir, e.name)
  return e.isDirectory() ? walk(full) : (e.name.endsWith('.php') ? [full] : [])
})
const files = walk(join(root, 'backend', 'app')).map(f => ({ f, src: readFileSync(f, 'utf8') }))
const audit = readFileSync(join(root, 'frontend', 'src', 'lib', 'audit.js'), 'utf8')

const fail = m => { console.error('FAIL  ' + m); process.exitCode = 1 }
const EVENT = /'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'/g

// Audit::record($request, <event>, …). The event is usually a literal, but not always, and each
// shape this cannot read must fail rather than be skipped — skipping is how three events went
// unchecked in the first version of this file:
//   - a ternary of literals ($u->disabled ? 'admin.user.disable' : 'admin.user.enable'): every
//     literal in the argument counts;
//   - a parameter ($event): the event names are the literals the same file passes to the
//     enclosing method (self::revoke($request, 'coach.invite.revoke')), so those count;
//   - anything else (a concatenation, a variable from elsewhere) fails, naming the line.
const emitted = new Set()
for (const { f, src } of files) {
  for (const call of src.matchAll(/\bAudit::record\(\s*\$\w+\s*,\s*([^,\[]+?)\s*(?:,|\))/g)) {
    const arg = call[1]
    const line = src.slice(0, call.index).split('\n').length
    const where = `${relative(root, f).split(sep).join('/')}:${line}`
    const literals = [...arg.matchAll(EVENT)].map(m => m[1])
    if (literals.length) { literals.forEach(e => emitted.add(e)); continue }
    const param = arg.match(/^\$(\w+)$/)
    // The method this call sits in, and the literals passed to it from the same file.
    const fn = param && [...src.slice(0, call.index).matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)].pop()
    const index = fn ? fn[2].split(',').findIndex(a => new RegExp(`\\$${param[1]}\\b`).test(a)) : -1
    const passed = index < 0 ? [] : [...src.matchAll(new RegExp(`(?:self|static|\\$this)(?:::|->)${fn[1]}\\(([^)]*)\\)`, 'g'))]
      .map(c => c[1].split(',')[index]?.trim().match(/^'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'$/)?.[1])
    if (passed.length && passed.every(Boolean)) { passed.forEach(e => emitted.add(e)); continue }
    fail(`${where}: Audit::record with an event this check cannot read (${arg.trim()}). Pass a literal, a ternary of literals, or a parameter the same file fills with literals.`)
  }
}

const labelled = new Set()
const block = audit.match(/const LABELS\s*=\s*\{([\s\S]*?)\n\}/)
if (block) for (const k of block[1].matchAll(/'([^']+)'\s*:/g)) labelled.add(k[1])

// Self-check first. A regex that matches nothing is indistinguishable from a clean run, which is
// how a guard rots into decoration. The floors are the counts on the day they were last raised
// (CHW-301, which retired api/ and raised them as CHW-276 asked), not token minimums: raise them
// deliberately when events are added. A DROP means the extractor stopped seeing calls that are
// still there.
const EVENT_FLOOR = 43
const LABEL_FLOOR = 43
if (emitted.size < EVENT_FLOOR) fail(`found ${emitted.size} audit events in backend/app, expected at least ${EVENT_FLOOR} — the extractor is broken, not the code`)
if (labelled.size < LABEL_FLOOR) fail(`found ${labelled.size} labels in audit.js, expected at least ${LABEL_FLOOR} — the extractor is broken, not the code`)

const missing = [...emitted].filter(e => !labelled.has(e)).sort()
if (missing.length) {
  fail(`${missing.length} audit event(s) the backend emits have no label in frontend/src/lib/audit.js:`)
  for (const m of missing) console.error(`        ${m}`)
  console.error('      The admin activity log would print these raw. Add them to LABELS.')
}

// Not an error: a label for an event nothing emits any more is harmless, and deleting it would
// break the history already in the audit log (including what was imported from Node's).
const orphan = [...labelled].filter(l => !emitted.has(l)).sort()

if (!process.exitCode)
  console.log(`OK    ${emitted.size} audit events, all labelled` + (orphan.length ? ` (${orphan.length} label(s) for events no longer emitted: ${orphan.join(', ')})` : ''))
