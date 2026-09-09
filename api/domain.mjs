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
// **Honest limit, and the reason this rejects by container rather than promising a codec:** the
// brand names the container, not the video track. An `isom` MP4 can legally carry HEVC, which
// Chrome and Firefox will not play. Knowing the codec for certain means walking moov → trak →
// stsd, which is a real parser and exactly the kind of thing §5 refuses to add. What this does
// catch is the case that actually happens — an iPhone on default settings records HEVC in a
// `.mov` with the `qt  ` brand — and it catches it at upload, with a message, instead of at
// playback on a client's Android phone with a black box.
export const MEDIA_SNIFF_BYTES = 32   // ftyp brand ends at 12; RIFF/WEBP needs 12. Headroom.

const BRAND_MP4 = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp4v', 'avc1', 'M4V ', 'dash', 'cmfc'])
const BRAND_HEVC = new Set(['hvc1', 'hev1', 'hvcC'])
const BRAND_HEIF = new Set(['heic', 'heix', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])
const BRAND_AVIF = new Set(['avif', 'avis'])

const ascii = (buf, from, to) => Buffer.from(buf.subarray(from, to)).toString('latin1')

// Every brand the box declares: the major one at 8, then the compatible list from 16 up to the
// box length at 0. The length is clamped to what was actually read — a truncated first chunk
// must not send this walking off the end of the buffer.
function isoBrands(buf) {
  const brands = [ascii(buf, 8, 12)]
  const declared = buf.readUInt32BE(0)
  const end = Math.min(declared > 0 ? declared : buf.length, buf.length)
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
  // Recognised so it can be refused by name rather than as "unknown file": a GIF would sail past
  // the client-side canvas downscale that every other photo goes through.
  if (ascii(b, 0, 4) === 'GIF8') return { kind: 'photo', ext: 'gif', mime: 'image/gif' }

  if (ascii(b, 4, 8) !== 'ftyp') return null
  const brands = isoBrands(b)
  const has = set => brands.some(x => set.has(x))
  // Order matters: an iPhone HEIC lists `mif1` alongside brands that look like nothing in
  // particular, and a `.mov` is a video whatever else it claims to be compatible with.
  if (has(BRAND_HEIF)) return { kind: 'photo', ext: 'heic', mime: 'image/heic', brand: brands[0] }
  if (has(BRAND_AVIF)) return { kind: 'photo', ext: 'avif', mime: 'image/avif', brand: brands[0] }
  if (brands[0] === 'qt  ') return { kind: 'video', ext: 'mov', mime: 'video/quicktime', brand: brands[0] }
  if (has(BRAND_HEVC)) return { kind: 'video', ext: 'mp4', mime: 'video/mp4', brand: brands.find(x => BRAND_HEVC.has(x)) }
  if (has(BRAND_MP4)) return { kind: 'video', ext: 'mp4', mime: 'video/mp4', brand: brands[0] }
  return null
}

// What each slot will store. Deliberately narrow: these are the formats every browser a client
// might open the app in can decode without help, which is the only property that matters here.
const ACCEPT_VIDEO = new Set(['mp4'])
const ACCEPT_PHOTO = new Set(['jpg', 'png', 'webp'])

/**
 * The upload gate. Mirrors validateAssignmentBundle: `{ error }` or the accepted descriptor.
 * Messages say what to do, because the person reading them is the coach who just filmed the
 * thing — "unsupported format" would send them back to the camera roll with no idea what to change.
 */
export function validateUpload(buf, want) {
  const m = sniffMedia(buf)
  if (!m) return { error: 'not a recognised image or video file' }
  if (m.kind !== want) return { error: `expected ${want === 'video' ? 'a video' : 'an image'}, got ${m.mime}` }

  if (want === 'video') {
    if (m.ext === 'mov') return { error: 'QuickTime .mov does not play in Chrome or Firefox — export or convert to MP4 (H.264) first' }
    if (BRAND_HEVC.has(m.brand)) return { error: 'this MP4 is HEVC, which does not play in Chrome or Firefox — re-encode as H.264' }
    if (!ACCEPT_VIDEO.has(m.ext)) return { error: `${m.mime} is not a supported video format — use MP4 (H.264)` }
  } else {
    if (m.ext === 'heic') return { error: 'HEIC photos do not display in most browsers — set the camera to “Most Compatible”, or export as JPEG' }
    if (!ACCEPT_PHOTO.has(m.ext)) return { error: `${m.mime} is not a supported image format — use JPEG, PNG or WebP` }
  }
  return { kind: m.kind, ext: m.ext, mime: m.mime }
}
