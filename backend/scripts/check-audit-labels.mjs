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
//   - a literal, or a ternary of two ($u->disabled ? 'admin.user.disable' : 'admin.user.enable');
//   - a parameter ($event) of a private method: the event names are the literals the same file
//     passes to it (self::revoke($request, 'coach.invite.revoke')), and being private, no other
//     file can pass it anything;
//   - anything else (a concatenation, even one with a literal in it, an array lookup, a call, a
//     variable from elsewhere) fails, naming the line — and so does a call this cannot even take
//     apart (a first argument that is not a plain variable, say): every `Audit::record(` outside
//     a comment is read, not only the ones the pattern fits.
const LITERAL = `'[a-z][a-z0-9]*(?:\\.[a-z0-9]+)+'`
const READABLE = new RegExp(`^(?:${LITERAL}|[^'"?]+\\?\\s*${LITERAL}\\s*:\\s*${LITERAL})$`)
const CALL = /\bAudit::record\s*\(\s*\$\w+\s*,\s*([^,\[]+?)\s*(?:,|\))/y
const emitted = new Set()
for (const { f, src } of files) {
  const file = relative(root, f).split(sep).join('/')
  // The other ways to reach Audit::record, which the scan below would not see.
  const indirect = /\buse\s+App\\Audit\\Audit\s+as\b/.test(src) || /\bAudit::class\b/.test(src)
    || (file === 'backend/app/Audit/Audit.php' && /\b(?:self|static)::record\s*\(/.test(src))
  if (indirect) fail(`${file}: reaches Audit::record by an alias, Audit::class or self::record, which this check `
    + 'cannot follow. Call it as Audit::record($request, <event>, …).')
  let line = 1, seen = 0
  for (const at of src.matchAll(/\bAudit::record\s*\(/g)) {
    for (; seen < at.index; seen++) if (src[seen] === '\n') line++
    const where = `${file}:${line}`
    const before = src.slice(src.lastIndexOf('\n', at.index) + 1, at.index)
    if (/^\s*(?:\*|\/\*)/.test(before) || before.includes('//')) continue   // a comment names it
    CALL.lastIndex = at.index
    const call = CALL.exec(src)
    if (!call) {
      fail(`${where}: an Audit::record call this check cannot read. Write it as Audit::record($request, <event>, …).`)
      continue
    }
    const arg = call[1]
    if (READABLE.test(arg)) { [...arg.matchAll(EVENT)].forEach(m => emitted.add(m[1])); continue }
    const param = arg.match(/^\$(\w+)$/)
    // The private method this call sits in, and the literals passed to it from the same file.
    const fn = param && [...src.slice(0, call.index).matchAll(/((?:\w+\s+)*)function\s+(\w+)\s*\(([^)]*)\)/g)].pop()
    const index = fn && /\bprivate\b/.test(fn[1]) ? fn[3].split(',').findIndex(a => new RegExp(`\\$${param[1]}\\b`).test(a)) : -1
    const passed = index < 0 ? [] : [...src.matchAll(new RegExp(`(?:self|static|\\$this)(?:::|->)${fn[2]}\\(([^)]*)\\)`, 'g'))]
      .map(c => c[1].split(',')[index]?.trim().match(/^'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'$/)?.[1])
    if (passed.length && passed.every(Boolean)) { passed.forEach(e => emitted.add(e)); continue }
    fail(`${where}: Audit::record with an event this check cannot read (${arg.trim()}). Pass a literal, a ternary of two literals, or a parameter of a private method the same file fills with literals.`)
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
const EVENT_FLOOR = 44
const LABEL_FLOOR = 44
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
