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
    // Free text, not a rooms table: a club has a handful of studios and a CRUD for them would be
    // more screens than it saves. The admin form autocompletes from rooms already in use, and
    // roomKey() below is what makes clash detection survive "Studio 1" vs "studio 1".
    room: String(raw.room || '').trim().slice(0, 40),
    // coachId is the real link to a coach account; `coach` stays as the display fallback so old
    // rows keep rendering and a guest instructor with no account can still be named.
    coach: String(raw.coach || '').trim().slice(0, 40),
    minutes: Math.max(5, Math.min(240, Math.round(+raw.minutes || 60))),
    note: String(raw.note || '').trim().slice(0, 200)
  }
  if (raw.coachId) s.coachId = String(raw.coachId)
  // A cancelled class stays on the timetable, struck through, so a member who planned around it
  // finds an answer instead of an absence. Deleting is a separate, deliberate action.
  if (raw.cancelled) {
    s.cancelled = true
    s.cancelReason = String(raw.cancelReason || '').trim().slice(0, 120)
  }
  const cap = raw.capacity
  if (cap != null && cap !== '' && +cap > 0) s.capacity = Math.min(500, Math.round(+cap))
  if (raw.id) s.id = String(raw.id)
  return { session: s }
}

/* ---------- clashes ---------- */
// Two classes cannot share a room, and one coach cannot be in two rooms at once. Nothing in the
// app enforced either, which on a timetable of spinning/yoga/Zumba across separate studios is the
// mistake that actually happens. Reported, not blocked: real clubs overlap deliberately
// (a handover, a room split), so the admin gets a warning and the final say.
const roomKey = r => String(r || '').trim().toLowerCase().replace(/\s+/g, ' ')
const minutesOf = hhmm => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''))
  return m ? +m[1] * 60 + +m[2] : null
}

// Half-open intervals, so 18:00-19:00 and 19:00-20:00 are back-to-back rather than a clash.
export function sessionsOverlap(a, b) {
  if (!a || !b || a.date !== b.date) return false
  const aS = minutesOf(a.time), bS = minutesOf(b.time)
  if (aS == null || bS == null) return false
  return aS < bS + (+b.minutes || 60) && bS < aS + (+a.minutes || 60)
}

// Candidate may be unsaved (no id yet). `skipSeriesId` lets a series-wide save ignore its own
// siblings, which would otherwise all report as clashes against each other.
export function findSessionConflicts(sessions, candidate, { skipSeriesId = null } = {}) {
  if (!candidate || candidate.cancelled) return []
  return (sessions || []).filter(s => {
    if (!s || s.cancelled) return false
    if (candidate.id && s.id === candidate.id) return false
    if (skipSeriesId && s.seriesId === skipSeriesId) return false
    if (!sessionsOverlap(s, candidate)) return false
    const sameRoom = !!roomKey(candidate.room) && roomKey(s.room) === roomKey(candidate.room)
    const sameCoach = !!candidate.coachId && s.coachId === candidate.coachId
    return sameRoom || sameCoach
  }).map(s => ({
    id: s.id, title: s.title, date: s.date, time: s.time, minutes: s.minutes,
    room: s.room || '', coachId: s.coachId || null, coach: s.coach || '',
    why: (!!roomKey(candidate.room) && roomKey(s.room) === roomKey(candidate.room)) ? 'room' : 'coach'
  }))
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

// Daily nutrition targets ride on the plan bundle instead of getting a channel of their own.
// There is exactly one reason: a target the SERVER writes into a member's state file is destroyed
// by that member's next whole-state push (see POST /api/coach/assign). Something the member
// accepts is the only kind that survives, and that mechanism already exists, already has an
// inbox, a withdraw, an expiry and a decide. A second push mechanism would be a second auth
// surface for one object with four numbers on it.
//
// Ceilings are slipped-decimal guards, not dietary advice: 20,000 kcal is far past any real
// prescription and 2,000 g of a single macro is not a number anyone means to type.
export const NUTRI_MAX_KCAL = 20000
export const NUTRI_MAX_MACRO = 2000
export const NUTRI_KEYS = ['kcal', 'p', 'c', 'f']

// null for "no targets on this bundle" — every field is optional, including all of them. A coach
// who sets calories and protein and leaves carbs and fat alone means exactly that, so an absent
// macro stays absent rather than becoming a 0 the member's screen would render as a target.
// Present-but-unusable is an ERROR rather than a silent drop: a coach who typed 2,200 into the
// wrong box has to hear about it here, not discover it never arrived a week later.
function cleanNutrition(raw) {
  if (raw == null) return { nutrition: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'nutrition targets are malformed' }
  const out = {}
  for (const k of NUTRI_KEYS) {
    const v = raw[k]
    if (v == null || v === '') continue
    const max = k === 'kcal' ? NUTRI_MAX_KCAL : NUTRI_MAX_MACRO
    if (!Number.isFinite(+v) || +v < 0 || +v > max) return { error: `nutrition target for ${k} is not a number between 0 and ${max}` }
    if (+v > 0) out[k] = Math.round(+v)
  }
  const note = String(raw.note || '').trim().slice(0, ASSIGN_NOTE_MAX)
  if (!Object.keys(out).length) return { nutrition: null }   // a note with no numbers is not a target
  return { nutrition: { ...out, ...(note ? { note } : {}) } }
}

/* ---------- the weekly check-in reminder ---------- */
// These three mirror frontend/src/lib/checkins.js, and the duplication is deliberate in the same
// way effectiveRoutineId's is in server.js: tiny pure rules, on the far side of a boundary the two
// runtimes cannot import across. **If the rule changes there, change it here** — a drift would be
// silent, because a reminder that fires on the wrong day looks exactly like one nobody set.
// DEFAULT_CHECKIN_DAY is tied to the frontend's by api/scripts/check-checkin-day.mjs.
export const DEFAULT_CHECKIN_DAY = 0   // Sunday: the day people review a week

export const checkinDayOf = S => {
  const d = S?.checkinDay
  return Number.isInteger(d) && d >= 0 && d <= 6 ? d : DEFAULT_CHECKIN_DAY
}

// The most recent occurrence of the check-in weekday, on or before todayIso — the start of the
// period a check-in belongs to. Midday and UTC on purpose: the caller has already resolved the
// date in the MEMBER's timezone, so this must not shift it again by parsing in the server's.
export function checkinPeriodStart(S, todayIso) {
  const want = checkinDayOf(S)
  const d = new Date(todayIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - want + 7) % 7))
  return d.toISOString().slice(0, 10)
}

/**
 * Should this member be pushed about their check-in today?
 *
 * ON THE DAY ONLY, not every day until they answer. The Home card is the thing that persists —
 * it stays up while one is owed — and a push repeating each morning is how somebody turns
 * notifications off for the whole app, taking the rest-timer and the workout reminder with it.
 * One nudge a week, on the day, is the whole budget.
 */
export function checkinReminderDue(S, todayIso) {
  if (new Date(todayIso + 'T12:00:00Z').getUTCDay() !== checkinDayOf(S)) return false
  const from = checkinPeriodStart(S, todayIso)
  return !(S?.checkins || []).some(c => c && c.d >= from)
}

// Which weekday a member's check-in falls on, 0 = Sunday, matching getDay() and
// lib/checkins.js. Rides the plan bundle for the same reason the nutrition targets do: the server
// cannot write into a member's state file — their next whole-state push would erase it — so a
// value they ACCEPT is the only kind that survives.
//
// Absent means "this bundle does not move the day", NOT "put it back to Sunday". A coach sending
// a new block should not silently reset a check-in day they deliberately moved three months ago,
// and the member who has been answering on a Wednesday since should not find the reminder has
// wandered because of a program that said nothing about it.
//
// 0 is a valid day and a falsy number, which is exactly the trap here — `raw.checkinDay || null`
// would turn a coach's deliberate "Sunday" into "leave it alone". Tested.
function cleanCheckinDay(raw) {
  if (raw == null || raw === '') return { checkinDay: null }
  // Type-checked before coercing, because Number() is far too willing: Number([]) is 0, and so is
  // Number(false) — so an empty array arriving in this field would have been accepted as a
  // deliberate "Sunday". Found by the test below, not by reading. Same reason cleanNutrition
  // checks Array.isArray before it trusts an object.
  if (typeof raw !== 'number' && typeof raw !== 'string') return { error: 'check-in day must be a weekday, 0 (Sunday) to 6' }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 6) return { error: 'check-in day must be a weekday, 0 (Sunday) to 6' }
  return { checkinDay: n }
}

// One place for "may this coach act on this member", because it guards five routes and getting
// it wrong in any one of them exposes another member's training history. Admins pass regardless
// (they own the gym); isAdmin is passed in rather than read here so this stays pure — the server's
// isAdmin also consults ADMIN_UIDS, which is env, not state.
export function canCoachMember(coach, member, { isAdmin = false } = {}) {
  if (!coach || !member || !coach.id || !member.id) return false
  if (member.id === coach.id) return false   // coaching yourself is the ordinary Plan screen
  if (member.disabled) return false
  // A locked-out coach is as unable to coach as a demoted one. Only the member's flag was
  // checked before, so a program from a disabled coach stayed acceptable — their session was
  // dead, but the offer already in the member's inbox was not.
  if (coach.disabled) return false
  return isAdmin || member.coachId === coach.id
}

/**
 * Is this code one that can still be redeemed, right now?
 *
 * Four places need the answer and they used to each spell it out: the two halves of registration,
 * the landing screen that asks whose invite this is, and redeeming one from an account that
 * already exists. Four copies of `!i.usedBy && !i.revoked` is four chances for one of them to
 * drift, and the one that drifts is the one that lets a spent code back in.
 *
 * Normalisation belongs here too. A code arrives typed, pasted with a trailing space, or lifted
 * out of a URL somebody lower-cased on the way — and the registration gate compared it raw, so
 * whether a real invite worked depended on the sender's keyboard.
 *
 * Deliberately says nothing about the code's SHAPE. Minted codes are 16 hex characters, but
 * BOOTSTRAP_CODE is whatever the operator exported and existing databases carry hand-written
 * ones; a format check here would quietly invalidate codes already in people's messages.
 */
export function redeemableInvite(invites, code) {
  const c = String(code == null ? '' : code).trim().toUpperCase()
  if (!c) return null
  const invite = (invites || []).find(i => i && i.code === c)
  if (!invite || invite.usedBy || invite.revoked) return null
  return invite
}

/**
 * Who, if anyone, does redeeming this invite put the new member with?
 *
 * The decision this makes is the whole of "a coach can take a client on", and it cannot be
 * reached from the smoke suite — registration needs a real passkey — so it lives here with tests
 * beside it, the way CONTRIBUTING asks for anything that decides something.
 *
 * `isCoach` is injected rather than computed, exactly as canCoachMember takes `isAdmin`: whether
 * someone counts as a coach depends on ADMIN_UIDS from the environment, which has no business in
 * a pure function.
 *
 * Two rules, both about time passing. The binding is read from the invite's explicit `coachId`
 * and never inferred from who created it — admins count as coaches, so inferring would make every
 * general admin invite silently assign that admin. And eligibility is judged NOW, not at mint
 * time: a code can sit unread in a message for a fortnight, and a coach disabled or demoted in
 * between must not keep acquiring clients. Returning null then is not a refusal of the signup —
 * the caller still registers the member, unassigned.
 */
export function coachBinding(invite, coach, { isCoach = false } = {}) {
  if (!invite || !invite.coachId) return null
  if (!coach || coach.id !== invite.coachId) return null
  if (!isCoach || coach.disabled) return null
  return coach.id
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
  const { nutrition, error: nutriError } = cleanNutrition(raw.nutrition)
  if (nutriError) return { error: nutriError }
  const { checkinDay, error: dayError } = cleanCheckinDay(raw.checkinDay)
  if (dayError) return { error: dayError }
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
      customEx,
      // Omitted rather than stored as null, so a bundle without targets is byte-identical to the
      // ones written before this existed and the member's client can test for the key.
      ...(nutrition ? { nutrition } : {}),
      // `!= null`, not a truthy test: 0 is Sunday, and dropping it here would make the one day
      // the app defaults to the one day a coach cannot deliberately choose.
      ...(checkinDay != null ? { checkinDay } : {})
    }
  }
}

/* ---------- the coach's program library ---------- */
// A saved program is a named bundle the coach can send later. It lives server-side in
// coach-<uid>.json rather than in the coach's own `S`, so it is not pushed on every state sync,
// survives a device, and can be read by the server; see the route block in server.js.
//
// The bundle goes through validateAssignmentBundle — the same gate the send route uses — because
// a program IS what gets sent, and a library row that would be refused at send time is a trap the
// coach only discovers when they try to use it.
export const COACH_MAX_PROGRAMS = 50
export const PROGRAM_NAME_MAX = 60

export function cleanProgram(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'program required' }
  const name = String(raw.name == null ? '' : raw.name).trim().slice(0, PROGRAM_NAME_MAX)
  if (!name) return { error: 'program needs a name' }
  const { bundle, error } = validateAssignmentBundle(raw.bundle)
  if (error) return { error }
  // The library row's own name wins over whatever the bundle carries: the coach renamed it here,
  // and a send built from this row should announce the name they can see.
  return { program: { name, bundle: { ...bundle, name } } }
}

// Upsert by id. Returns a NEW array — callers write it back — and refuses past the cap only when
// the write would add a row, so renaming or re-saving an existing program never hits the wall.
export function upsertProgram(programs, { id, name, bundle }, now) {
  const list = Array.isArray(programs) ? programs : []
  const { program, error } = cleanProgram({ name, bundle })
  if (error) return { error }
  // A string, and one that could have come from crypto.randomUUID(). Anything else — an object,
  // an array — is stored verbatim by a caller that trusts it, then never matches on the way back
  // out (findIndex compares by reference), so every re-save appends a row until the cap locks the
  // coach out of saving entirely.
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { error: 'program id required', code: 'bad-id' }
  const at = list.findIndex(p => p && p.id === id)
  if (at < 0 && list.length >= COACH_MAX_PROGRAMS)
    // `code`, not the wording: the route decides 429 vs 400 from this, and an earlier version
    // matched the message text, so rewording this line silently downgraded the cap to a 400.
    return { error: `you have ${COACH_MAX_PROGRAMS} programs — delete one before saving another`, code: 'cap' }
  const row = {
    id: at >= 0 ? list[at].id : id,
    name: program.name,
    created: at >= 0 ? list[at].created : now,
    updated: now,
    bundle: program.bundle
  }
  const next = list.slice()
  if (at >= 0) next[at] = row; else next.push(row)
  return { programs: next, program: row }
}

export const pendingAssignmentsFor = (assignments, memberId) =>
  (assignments || []).filter(a => a.memberId === memberId && a.status === 'pending')

/**
 * Drop rows nobody needs any more — with one exception that the 30-day window would otherwise
 * break: the program a member is CURRENTLY ON.
 *
 * ASSIGN_DECIDED_DAYS exists so answered offers do not accumulate for ever, and for declined and
 * superseded rows that is exactly right. But the newest accepted row is not history, it is the
 * plan the person is training: a client on an eight- or twelve-week block would watch "Your
 * program" turn into "Nothing accepted yet" about a month in, while still doing that exact plan
 * every week. This runs on every assign by any coach, so it does not even wait for them to do
 * anything.
 *
 * Keeping one row per member is bounded by the number of members, which is the same bound
 * db.users already has — it is not a leak in the shape this window was written to prevent.
 */
export function pruneAssignments(assignments, now = Date.now()) {
  const list = assignments || []
  // The newest accepted row per member, by decidedAt. Computed first so the filter below can
  // exempt it by identity rather than by re-deriving the rule per row.
  const current = new Map()
  for (const a of list) {
    if (!a || a.status !== 'accepted') continue
    const t = Date.parse(a.decidedAt || a.created || '') || 0
    const held = current.get(a.memberId)
    if (!held || t > held.t) current.set(a.memberId, { a, t })
  }
  const keep = new Set([...current.values()].map(x => x.a))
  return list.filter(a => {
    if (keep.has(a)) return true
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

/* ---------- coaching: uploaded media ---------- */
// Coach exercise demos and client progress photos are the first bytes this API accepts that are
// not JSON. `Content-Type` is whatever the uploader chose to send and is not evidence of
// anything, so the file is identified by its own leading bytes instead.
//
// The awkward part is that MP4, QuickTime .mov, HEIC and AVIF are all the SAME container
// (ISO base media, a leading `ftyp` box) and differ only by the four-character brand inside it.
// A sniff that stops at "there is an ftyp here" accepts an iPhone photo as a video. So the brand
// is read, and the compatible-brand list after it too, because Apple writes the interesting one
// there as often as in the major slot.
//
// **Honest limit:** the brand names the container, not the video track. An `isom` MP4 can legally
// carry HEVC, which Chrome and Firefox will not play. Knowing the codec for certain means walking
// moov → trak → stsd, which is a real parser and exactly the kind of thing §5 refuses to add.
//
// **This labels; it does not refuse.** An earlier revision rejected HEVC and QuickTime at upload,
// which is wrong for the one person who uploads here. An iPhone records **HEVC in a `.mov`** on
// its default "High Efficiency" setting, and — this is the part that makes rejection untenable
// rather than merely inconvenient — the Camera app writes a `.mov` container on *both* format
// settings. "Most Compatible" changes the codec to H.264 and leaves the container alone. So a
// rule that refuses QuickTime refuses the coach's own camera roll no matter what they set.
// Since iOS 13.6.1 Safari also hands a site the original file instead of converting it on the
// way through a file input, so this is every upload from the phone, not an edge case.
//
// The playback problem is real and does not go away by accepting the file — it moves to whoever
// consumes `needsTranscode`. That is the right place for it: refusing here does not get the demo
// filmed, and a coach who cannot upload from the phone they filmed on has no workflow at all.
// 64 rather than 32. The major brand does end at 12, but the classification below turns on the
// COMPATIBLE list, which starts at offset 16 — so a 32-byte window held only four of them, and
// the brand that decides the answer is routinely not in the first four. An `hvc1` past the
// window reads as an ordinary MP4 and comes back `needsTranscode: false`, which is the one flag
// this module exists to set. 64 carries a major brand plus twelve compatible ones, past anything
// Apple or ffmpeg writes.
export const MEDIA_SNIFF_BYTES = 64

const BRAND_MP4 = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp4v', 'avc1', 'M4V ', 'dash', 'cmfc'])
const BRAND_HEVC = new Set(['hvc1', 'hev1'])
const BRAND_HEIF = new Set(['heic', 'heix', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])
const BRAND_AVIF = new Set(['avif', 'avis'])

const ascii = (buf, from, to) => Buffer.from(buf.subarray(from, to)).toString('latin1')

// Every brand the box declares: the major one at 8, then the compatible list from 16.
//
// Three separate things have to be clamped, and the buffer length alone covers only the first:
//   · a first chunk is a PREFIX, so the declared box length routinely exceeds the bytes in hand;
//   · a declared length of 0 means "to the end of the file" in ISO-BMFF — it is not a length;
//   · a caller handing over the WHOLE file would otherwise have every 4-byte-aligned window in
//     it tested against the brand sets. That is not theoretical: a 20 MB MP4 with a size-0 ftyp
//     took 1.5s of blocked event loop on a single-threaded server, allocated a ~5M-entry array,
//     and came back `image/heic` because four payload bytes somewhere spelled `mif1` — so the
//     coach's valid video was refused with "expected a video, got image/heic".
// The sniff window is therefore the contract, not a suggestion: nothing past MEDIA_SNIFF_BYTES
// is ever consulted, however much the caller passes in.
function isoBrands(buf) {
  const brands = [ascii(buf, 8, 12)]
  const declared = buf.readUInt32BE(0)
  const end = Math.min(declared || buf.length, buf.length, MEDIA_SNIFF_BYTES)
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(buf, i, i + 4))
  return brands
}

/**
 * Identify an upload from its leading bytes. Descriptive only — it says what the file is, never
 * whether it is wanted; validateUpload() decides that.
 * @returns {{kind:'video'|'photo', ext:string, mime:string, brand?:string}|null} null if unknown.
 */
export function sniffMedia(buf) {
  if (!buf || buf.length < 12) return null
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'photo', ext: 'jpg', mime: 'image/jpeg' }
  if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'photo', ext: 'png', mime: 'image/png' }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'photo', ext: 'webp', mime: 'image/webp' }
  if (ascii(b, 0, 4) === 'GIF8') return { kind: 'photo', ext: 'gif', mime: 'image/gif' }

  if (ascii(b, 4, 8) !== 'ftyp') return null
  const brands = isoBrands(b)
  const has = set => brands.some(x => set.has(x))
  // Order matters, and AVIF has to come first: MIAF conformance REQUIRES an AVIF to carry `mif1`
  // in its compatible list, and `mif1` is a HEIF brand — so testing HEIF first swallows every
  // real AVIF ever written and hands the uploader camera-setting advice about a file that never
  // came from a camera. `avif`/`avis` are unambiguous, so the specific test goes before the
  // general one. (An earlier revision had this backwards, and its test passed only because the
  // fixture had an empty compatible list, which no encoder produces.)
  if (has(BRAND_AVIF)) return { kind: 'photo', ext: 'avif', mime: 'image/avif', brand: brands[0] }
  // An iPhone HEIC lists `mif1` alongside brands that look like nothing in particular, and a
  // `.mov` is a video whatever else it claims to be compatible with.
  if (has(BRAND_HEIF)) return { kind: 'photo', ext: 'heic', mime: 'image/heic', brand: brands[0] }
  if (brands[0] === 'qt  ') return { kind: 'video', ext: 'mov', mime: 'video/quicktime', brand: brands[0] }
  if (has(BRAND_HEVC)) return { kind: 'video', ext: 'mp4', mime: 'video/mp4', brand: brands.find(x => BRAND_HEVC.has(x)) }
  if (has(BRAND_MP4)) return { kind: 'video', ext: 'mp4', mime: 'video/mp4', brand: brands[0] }
  return null
}

const ACCEPT_VIDEO = new Set(['mp4', 'mov'])
// The criterion is "every browser a client might open the app in can decode this", and GIF meets
// it as squarely as the other three. An earlier revision refused it on the grounds that it would
// bypass the client-side canvas downscale — which does not hold up: the canvas is a convenience
// on the way out of the phone, not a boundary anything server-side can rely on, and animated
// WebP bypasses it identically while sitting on this list. Refusing the one animated format it
// happened to name and passing the other was an inconsistency, not a rule. Size is the size
// cap's job.
const ACCEPT_PHOTO = new Set(['jpg', 'png', 'webp', 'gif'])

/**
 * The upload gate. Mirrors validateAssignmentBundle: `{ error }` or the accepted descriptor.
 * Messages say what to do, because the person reading them is the coach who just filmed the
 * thing — "unsupported format" would send them back to the camera roll with no idea what to change.
 *
 * `needsTranscode` is the interesting field. It is NOT "this file is broken" — it is "nothing
 * downstream should assume a client's browser can play this yet". It is set for the QuickTime
 * container and for an HEVC brand, i.e. for exactly what an iPhone hands over.
 *
 * The inverse does not hold and must not be read as if it did: `needsTranscode: false` means
 * nothing in the header said otherwise, not that the file was verified playable. An `isom` MP4
 * can still carry HEVC (see sniffMedia's header). Treat it as the best guess available without
 * a parser, which is what it is.
 */
export function validateUpload(buf, want) {
  const m = sniffMedia(buf)
  if (!m) return { error: 'not a recognised image or video file' }
  if (m.kind !== want) return { error: `expected ${want === 'video' ? 'a video' : 'an image'}, got ${m.mime}` }

  if (want === 'video') {
    if (!ACCEPT_VIDEO.has(m.ext)) return { error: `${m.mime} is not a supported video format — use MP4 or MOV` }
    return { kind: m.kind, ext: m.ext, mime: m.mime, needsTranscode: m.ext === 'mov' || BRAND_HEVC.has(m.brand) }
  }
  // Photos stay narrow, and the asymmetry with video is deliberate rather than an oversight.
  // The client downscales a photo on a <canvas> before upload (§5: 1600px, toBlob 0.82, which
  // strips EXIF/GPS as a side effect), and the canvas has to decode the source to do it — so
  // Safari converts an iPhone's HEIC to JPEG for free, on the phone, on the way past. There is
  // no equivalently cheap client-side step for video, which is the whole reason video needs the
  // flag above and photos do not.
  if (m.ext === 'heic') return { error: 'HEIC photos do not display in most browsers — set the camera to “Most Compatible”, or export as JPEG' }
  if (!ACCEPT_PHOTO.has(m.ext)) return { error: `${m.mime} is not a supported image format — use JPEG, PNG, WebP or GIF` }
  return { kind: m.kind, ext: m.ext, mime: m.mime, needsTranscode: false }
}

/**
 * May this server open a filename it read out of its own metadata? A whitelist, never a
 * blacklist of traversal tricks: the set of names that are fine is trivial to state, and the set
 * of tricks that are not is famously open-ended. Nothing a caller types reaches here — both media
 * routes address a row by id — so this is the guard against a hand-edited or truncated db.json,
 * which is a plain file an operator can and does edit.
 *
 * The first character has its own class for exactly ONE reason: to keep a dot out of it. A
 * leading dot is the shape that means something to a filesystem, and it is what the upload
 * routes' own temp files ('.up-…') are named. '-' and '_' are ordinary characters here and must
 * be allowed — a progress photo's name is base64url, whose alphabet includes both, so 2 in 64
 * names start with one. A first class of [A-Za-z0-9] accepted those uploads and then refused to
 * serve them back: one photo in thirty-two a permanent broken tile, on both the client's sheet
 * and the coach's screen, with no delete route to clear it and a retake carrying the same odds.
 *
 * typeof before the pattern, and not for tidiness: RegExp.test coerces, so a row with no `file`
 * at all is tested as the string "undefined" — which MATCHES — and then throws on the real
 * undefined. A damaged row must refuse, not 500.
 */
export function safeMediaFile(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name) && !name.includes('..')
}
