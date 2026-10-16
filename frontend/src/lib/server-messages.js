// What the API refuses with, in the user's language (CHW-199).
//
// The server speaks English, and English is the translation key, so a plain refusal ("challenge
// expired — try again") is just t(message). One with a value in it ("that exercise already has 6
// videos") is not a key as sent: it is matched against the template the server built it from and
// translated with the values carried across. SERVER_TEMPLATES is kept equal to the API's say
// templates by api/scripts/check-error-strings.mjs, which reads this list as JSON text — keep it
// double-quoted, with no trailing comma.
import { t } from './i18n-core.js'

export const SERVER_TEMPLATES = [
  "file is larger than the {0} MB limit",
  "that is {0} photos already stored",
  "that is {0} MB of photos already stored",
  "request body is larger than the {0} MB limit",
  "your training data is over the {0} MB limit for one sync, so this device could not save to the server. Delete some old workouts, or export a backup and start a fresh profile.",
  "you already have {0} unused codes — revoke one before making another",
  "that exercise already has {0} videos",
  "{0} already has {1} programs waiting",
  "nutrition target for {0} is not a number between 0 and {1}",
  "too many routines (max {0})",
  "a routine has more than {0} exercises",
  "you have {0} programs — delete one before saving another",
  "expected a video, got {0}",
  "expected an image, got {0}",
  "{0} is not a supported video format — use MP4 or MOV",
  "{0} is not a supported image format — use JPEG, PNG, WebP or GIF",
  "verification failed: {0}",
  "{0} — this server is configured with RP_ID={1} and ORIGIN={2}, and both must match the address you opened. See docs/SELF_HOSTING.md."
]

// The server numbers a template's values in the order they appear, so each {n} becomes the next
// capture group.
let matchers
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function serverText(message) {
  const s = String(message ?? '')
  matchers ||= SERVER_TEMPLATES.map(k => [k, new RegExp('^' + k.split(/\{\d+\}/).map(escape).join('(.+?)') + '$', 's')])
  for (const [k, re] of matchers) {
    const m = re.exec(s)
    if (m) return t(k, ...m.slice(1))
  }
  return t(s)
}
