#!/usr/bin/env node
// DEFAULT_CHECKIN_DAY exists twice: frontend/src/lib/checkins.js decides which day the member's
// screen calls a period, and api/domain.mjs decides which day the server pushes a reminder on.
// Neither runtime can import the other's copy, so nothing but this ties them together.
//
// Breaking them apart does not error. The member's Home card would say a check-in is owed on a
// Sunday while the push arrived on a Monday, or the reminder would fire for a period the app
// considers already closed — a reminder on the wrong day reads exactly like one nobody asked for,
// and the member turns notifications off rather than reporting it.
//
// Same shape and same reason as check-adherence-window.mjs, which ties ADHERENCE_SEND_DAYS to
// ADHERENCE_WINDOW_DAYS across the same boundary.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = p => readFileSync(join(root, p), 'utf8')

// Captured rather than imported: importing the frontend module would drag in its own imports and
// a build step, and this only needs the number.
const grab = (src, file) => {
  const m = src.match(/DEFAULT_CHECKIN_DAY\s*=\s*(\d+)/)
  if (!m) {
    console.error(`FAIL  could not find DEFAULT_CHECKIN_DAY in ${file} — it was renamed or removed,`)
    console.error('      which means this check has stopped checking anything. Fix the pattern.')
    process.exit(1)
  }
  return Number(m[1])
}

const api = grab(read('api/domain.mjs'), 'api/domain.mjs')
const web = grab(read('frontend/src/lib/checkins.js'), 'frontend/src/lib/checkins.js')

if (api !== web) {
  console.error(`FAIL  DEFAULT_CHECKIN_DAY disagrees: api/domain.mjs says ${api}, frontend says ${web}.`)
  console.error('      The reminder would fire on a different day from the one the app calls a period.')
  process.exit(1)
}

// 0-6 or the whole notion of a weekday is broken; both files document 0 = Sunday.
if (!Number.isInteger(api) || api < 0 || api > 6) {
  console.error(`FAIL  DEFAULT_CHECKIN_DAY is ${api}, which is not a weekday (0 = Sunday .. 6).`)
  process.exit(1)
}

console.log(`OK    DEFAULT_CHECKIN_DAY is ${api} on both sides`)
