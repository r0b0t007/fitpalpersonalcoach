// Pure domain helpers for access requests and group sessions — kept out of server.js so
// they can be unit-tested (node --test) without booting the HTTP server or touching disk.

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
