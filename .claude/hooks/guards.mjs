#!/usr/bin/env node
// Runs the cross-boundary guards the moment a file they watch is edited, instead of waiting for
// CI. These are the checks a test CANNOT do: they compare two values on either side of a boundary
// neither runtime can import across, and getting one wrong is silent — a reminder that fires on
// the wrong day, an audit line that prints a dotted identifier at a person, a module that exists
// in the repo but not in the deploy bundle (which has taken the API down twice).
//
// Read on stdin: the hook payload, {"tool_input":{"file_path":"..."}}. No jq on this machine, and
// no dependencies here on purpose — this has to run before anything is installed.
//
// Exit 2 is the blocking code: the edit has already happened, and Claude is told what broke.
// check-bundle-complete.mjs is deliberately absent — it needs a built deploy bundle, which is a
// CI-only artifact.
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scripts = join(root, 'api', 'scripts')

// Which guard watches which file. A guard runs when ANY of its files is touched, because both
// sides of a pair have to agree and either one can be the one that moved.
const GUARDS = [
  ['check-audit-labels.mjs', ['api/server.js', 'frontend/src/lib/audit.js']],
  ['check-adherence-window.mjs', ['api/server.js', 'frontend/src/lib/adherence.js']],
  ['check-checkin-day.mjs', ['api/domain.mjs', 'frontend/src/lib/checkins.js']],
  ['check-core-loadable.mjs', ['api/server.js', 'api/domain.mjs']],
]

const read = () => new Promise(resolve => {
  let s = ''
  process.stdin.on('data', d => { s += d })
  process.stdin.on('end', () => resolve(s))
  // A hook invoked with no stdin must not hang the turn.
  setTimeout(() => resolve(s), 2000).unref?.()
})

// A payload this cannot parse is not a reason to fail an edit — stay out of the way.
let payload = {}
try { payload = JSON.parse((await read()) || '{}') } catch { process.exit(0) }
const file = payload?.tool_input?.file_path || payload?.tool_response?.filePath
if (!file) process.exit(0)

// Compare on a repo-relative posix path, so it works whatever shape the hook hands over.
let rel
try { rel = relative(root, file).split(sep).join('/') } catch { process.exit(0) }
if (!rel || rel.startsWith('..')) process.exit(0)

const due = GUARDS.filter(([, files]) => files.includes(rel)).map(([script]) => script)
if (!due.length) process.exit(0)

const failures = []
for (const script of due) {
  try {
    execFileSync(process.execPath, [join(scripts, script)], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    // The guards write their explanation to stderr and their OK line to stdout.
    failures.push(`${script}:\n${String(e.stderr || e.stdout || e.message).trim()}`)
  }
}

if (!failures.length) process.exit(0)
console.error(
  `A cross-boundary guard failed after editing ${rel}. These catch drift no test can see — fix it now, not in CI.\n\n` +
  failures.join('\n\n')
)
process.exit(2)
