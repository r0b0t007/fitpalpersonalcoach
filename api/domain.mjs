// Pure domain helpers for access requests, group sessions and first-run bootstrap — kept out of
// server.js so they can be unit-tested (node --test) without booting the HTTP server or touching
// disk. The one import is node's own constant-time compare; nothing here reads env or state.
import { timingSafeEqual } from 'node:crypto'

/* ---------- access requests ---------- */
export const REQ_PENDING_DAYS = 14   // a request nobody decided on expires by itself
export const REQ_DECIDED_DAYS = 30   // decided history kept this long, then dropped
export const REQ_MAX_PENDING = 500   // global backstop only — the per-phone dedupe is the real guard

export const normPhone = p => String(p || '').replace(/\D/g, '')

// The same line arrives as '+41 79 111 22 33', '0041791112233' or '079 111 22 33' depending on
// who typed it — full digit equality treats those as three people. The last 9 digits survive
// every prefix convention, and a rare collision only suppresses a duplicate pending row.
export const samePhone = (a, b) => {
  const x = normPhone(a).slice(-9), y = normPhone(b).slice(-9)
  return !!x && x === y
}

export const hasPendingPhone = (requests, phone) =>
  (requests || []).some(r => r.status === 'pending' && samePhone(r.phone, phone))

// db.json is rewritten whole on every save, so stale requests are dropped rather than kept
// forever: pending ones expire (nobody is coming back for them), decided ones age out of the
// history the admin sees.
export function pruneRequests(requests, now = Date.now()) {
  return (requests || []).filter(r => {
    const days = r.status === 'pending' ? REQ_PENDING_DAYS : REQ_DECIDED_DAYS
    const t = Date.parse((r.status === 'pending' ? r.created : r.decidedAt || r.created) || '') || 0
    return now - t < days * 86400000
  })
}

// Mutates the request in place (it lives inside db.requests); mintCode is called only on
// approval so a rejection never burns an invite code.
export function decideRequest(request, approve, mintCode, now = Date.now()) {
  if (!request) return { error: 'no such request' }
  if (request.status !== 'pending') return { error: 'already decided' }
  if (approve) { request.status = 'approved'; request.code = mintCode() }
  else request.status = 'rejected'
  request.decidedAt = new Date(now).toISOString()
  return { request }
}

/* ---------- group sessions ---------- */
export const SESSION_KEEP_DAYS = 60    // pruned on save once this far in the past
export const SESSION_WINDOW_DAYS = 7   // GET /api/sessions serves from this many days back
export const MAX_REPEAT_WEEKS = 26

// Date must exist on the calendar. Date.UTC would happily roll 2026-02-30 over to March 2 —
// exactly the silent "fix" that puts a class on the wrong day — so the components are checked
// against what the Date actually landed on.
export function isRealDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

// UTC-component arithmetic, so DST never shifts a date; '' for input that isn't a date at all.
export function addDaysISO(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return ''
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n, 12)).toISOString().slice(0, 10)
}

// Inline-coercion validation, same idiom as server.js: clamp what can be clamped, reject the
// two fields where a silently "fixed" value would put the class on the wrong day or hour —
// a bad date doesn't error anywhere downstream, it just vanishes from the calendar.
export function validateSession(raw) {
  const title = String(raw.title || '').trim().slice(0, 60)
  if (!title) return { error: 'title required' }
  const date = String(raw.date || '').trim()
  if (!isRealDate(date)) return { error: 'invalid date' }
  const time = String(raw.time || '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'invalid time' }
  const s = {
    title, date, time,
    coach: String(raw.coach || '').trim().slice(0, 40),
    minutes: Math.max(5, Math.min(240, Math.round(+raw.minutes || 60))),
    note: String(raw.note || '').trim().slice(0, 200)
  }
  const cap = raw.capacity
  if (cap != null && cap !== '' && +cap > 0) s.capacity = Math.min(500, Math.round(+cap))
  if (raw.id) s.id = String(raw.id)
  return { session: s }
}

// repeatWeeks dated copies at +7d steps — covers weekly classes without a recurring-rule
// engine. Copies share a seriesId so "edit/delete all upcoming" can find its siblings.
export function expandRepeats(session, repeatWeeks, newId) {
  const weeks = Math.max(1, Math.min(MAX_REPEAT_WEEKS, Math.round(+repeatWeeks || 1)))
  const seriesId = weeks > 1 ? newId() : null
  const out = []
  for (let i = 0; i < weeks; i++) {
    const s = { ...session, id: newId(), date: addDaysISO(session.date, 7 * i) }
    if (seriesId) s.seriesId = seriesId
    out.push(s)
  }
  return out
}

export const pruneSessions = (sessions, todayIso) =>
  (sessions || []).filter(s => s.date >= addDaysISO(todayIso, -SESSION_KEEP_DAYS))

export const sessionSort = (a, b) => (a.date + a.time).localeCompare(b.date + b.time)

/* ---------- first-run bootstrap ---------- */
// INVITE_ONLY plus an empty database is a closed loop: registering needs an invite, invites are
// minted only by an admin, and admins are recognised only by ADMIN_UIDS — so nobody, the operator
// included, can ever get in. BOOTSTRAP_CODE breaks the loop without opening the door: it counts as
// an invite for the very first account, and that account is made an admin. It disarms itself the
// moment a user exists — unlike the alternative of running INVITE_ONLY=0 for a while, which opens
// the instance to whoever finds it first and stays open until someone remembers to close it.
//
// Note this is a live condition, not a one-time event: it is re-evaluated per request against the
// current user count, so an instance whose data directory is lost or restored from an empty backup
// re-arms while the variable is still set. Clearing it after bootstrapping is what makes "spent"
// unconditional.
export const BOOTSTRAP_MIN = 16

// Matched case-insensitively, because the sign-in form upper-cases whatever is typed into the code
// field — the length floor is what stops that from costing real entropy. Constant-time compare so
// the secret can't be recovered a byte at a time; the length check comes first because
// timingSafeEqual throws on differing lengths (and a length leak is not the secret).
export function bootstrapMatches(code, secret, userCount) {
  const want = String(secret || '').trim().toUpperCase()
  if (want.length < BOOTSTRAP_MIN) return false
  if (userCount !== 0) return false
  const got = Buffer.from(String(code || '').trim().toUpperCase())
  const exp = Buffer.from(want)
  return got.length === exp.length && timingSafeEqual(got, exp)
}

/* ---------- coaching: assignments ---------- */
// A coach pushes a plan bundle to a member, who accepts or declines it. The bundle is the same
// shape buildPlanBundle() produces for the "share a plan with a friend" file, so a coach programs
// in the ordinary Plan screen and nothing new has to be authored.
//
// Deliberately NOT validated against the exercise catalogue here: that lives in the frontend
// (~870 KB) along with i18n, and the API has no business importing either. The member's client
// re-reads the bundle through parsePlan() on accept, which drops exercises it doesn't know. So
// this is a structural and anti-abuse gate — shape, and bounds on what one coach can park in
// db.json — not a semantic one.
export const ASSIGN_MAX_ROUTINES = 20
export const ASSIGN_MAX_EX = 60            // per routine
export const ASSIGN_MAX_CUSTOM = 100
export const ASSIGN_MAX_BYTES = 128 * 1024
export const ASSIGN_MAX_PENDING = 5        // per member, so a coach cannot flood one inbox
export const ASSIGN_NOTE_MAX = 280
export const ASSIGN_PENDING_DAYS = 30      // an offer nobody answered expires by itself
export const ASSIGN_DECIDED_DAYS = 30      // decided history kept this long, then dropped

// One place for "may this coach act on this member", because it guards five routes and getting
// it wrong in any one of them exposes another member's training history. Admins pass regardless
// (they own the gym); isAdmin is passed in rather than read here so this stays pure — the server's
// isAdmin also consults ADMIN_UIDS, which is env, not state.
export function canCoachMember(coach, member, { isAdmin = false } = {}) {
  if (!coach || !member || !coach.id || !member.id) return false
  if (member.id === coach.id) return false   // coaching yourself is the ordinary Plan screen
  if (member.disabled) return false
  return isAdmin || member.coachId === coach.id
}

export function validateAssignmentBundle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'plan required' }
  if (!raw.opengym_plan) return { error: 'not a plan bundle' }
  if (!Array.isArray(raw.routines) || raw.routines.length === 0) return { error: 'plan has no routines' }
  if (raw.routines.length > ASSIGN_MAX_ROUTINES) return { error: `too many routines (max ${ASSIGN_MAX_ROUTINES})` }
  for (const r of raw.routines) {
    if (!r || typeof r !== 'object' || !r.id || !Array.isArray(r.ex)) return { error: 'malformed routine' }
    if (r.ex.length > ASSIGN_MAX_EX) return { error: `a routine has more than ${ASSIGN_MAX_EX} exercises` }
    for (const e of r.ex) if (!e || typeof e !== 'object' || !e.id) return { error: 'malformed exercise' }
  }
  const customEx = Array.isArray(raw.customEx) ? raw.customEx.filter(c => c && c.id) : []
  if (customEx.length > ASSIGN_MAX_CUSTOM) return { error: 'too many custom exercises' }
  // Size last: cheap checks first, and this one serialises the whole thing.
  let bytes
  try { bytes = Buffer.byteLength(JSON.stringify(raw)) } catch { return { error: 'plan is not serialisable' } }
  if (bytes > ASSIGN_MAX_BYTES) return { error: 'plan is too large' }
  // Rebuilt rather than stored as-is, so a caller cannot smuggle extra top-level keys into db.json.
  return {
    bundle: {
      opengym_plan: raw.opengym_plan,
      name: String(raw.name || '').slice(0, 80),
      week: raw.week && typeof raw.week === 'object' && !Array.isArray(raw.week) ? raw.week : {},
      routines: raw.routines,
      customEx
    }
  }
}

export const pendingAssignmentsFor = (assignments, memberId) =>
  (assignments || []).filter(a => a.memberId === memberId && a.status === 'pending')

export function pruneAssignments(assignments, now = Date.now()) {
  return (assignments || []).filter(a => {
    const days = a.status === 'pending' ? ASSIGN_PENDING_DAYS : ASSIGN_DECIDED_DAYS
    const t = Date.parse((a.status === 'pending' ? a.created : a.decidedAt || a.created) || '') || 0
    return now - t < days * 86400000
  })
}

// Mirrors decideRequest: the member is the only one who can answer, and only once.
export function decideAssignment(assignment, accept, now = Date.now()) {
  if (!assignment) return { error: 'no such assignment' }
  if (assignment.status !== 'pending') return { error: 'already decided' }
  assignment.status = accept ? 'accepted' : 'declined'
  assignment.decidedAt = new Date(now).toISOString()
  return { assignment }
}
