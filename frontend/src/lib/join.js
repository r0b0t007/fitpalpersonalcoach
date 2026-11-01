// Asking to join a coach (CHW-336): the intake's lists, the check the form makes before sending,
// and the request this browser keeps. The server holds the same lists (backend/app/Coaching/
// Intake.php) and decides; this only spares a refusal and keeps the request across a reload.
import { normaliseHandle } from './coach-page.js'

export const GOALS = ['strength', 'fat_loss', 'muscle', 'fitness', 'sport', 'other']
export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const EQUIPMENT = ['gym', 'home', 'dumbbells', 'bands', 'none']
export const INJURIES_MAX = 500

/** Faster than this, the server takes the form for a bot's (and quietly keeps nothing). */
export const MIN_FILL_MS = 3000

/**
 * What stops this intake being sent, or null: 'basics' (goal, level, days a week), 'consent', or
 * 'injuries' (too long). The phone is the server's to judge — it knows every country's digits.
 */
export function intakeError(i) {
  if (!GOALS.includes(i?.goal) || !LEVELS.includes(i?.level) || !Number.isInteger(i?.days) || i.days < 1 || i.days > 7) return 'basics'
  if ((i.injuries || '').trim().length > INJURIES_MAX) return 'injuries'
  if (i.consent !== true) return 'consent'
  return null
}

/** The handle of a join path (`/join/<handle>`), or null; a mangled link gives null, never a throw. */
export function joinHandleFromPath(pathname) {
  const m = /^\/join\/([^/]+)\/?$/.exec(pathname || '')
  if (!m) return null
  try { return normaliseHandle(decodeURIComponent(m[1])) } catch { return null }
}

// The request this browser sent: its id and the token that reads it (and, once the coach accepts,
// signs in — CHW-337). Per coach, so asking two coaches keeps both. Storage may be off (private
// mode): then the request still goes, and only the reload loses it.
const KEY = handle => 'join:' + handle

export function savedRequest(handle) {
  try {
    const r = JSON.parse(localStorage.getItem(KEY(handle)) || 'null')
    return r && typeof r.id === 'string' && typeof r.token === 'string' ? r : null
  } catch { return null }
}

export function saveRequest(handle, { id, token }) {
  try { localStorage.setItem(KEY(handle), JSON.stringify({ id, token })) } catch { /* storage off: see above */ }
}

export function forgetRequest(handle) {
  try { localStorage.removeItem(KEY(handle)) } catch { /* nothing kept to forget */ }
}
