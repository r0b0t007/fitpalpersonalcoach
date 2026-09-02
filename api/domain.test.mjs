// node --test — pure-logic tests for the access-request and group-session helpers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normPhone, hasPendingPhone, pruneRequests, decideRequest,
  addDaysISO, isRealDate, validateSession, expandRepeats, pruneSessions, sessionSort,
  REQ_PENDING_DAYS, REQ_DECIDED_DAYS, MAX_REPEAT_WEEKS,
  bootstrapMatches, BOOTSTRAP_MIN,
  canCoachMember, validateAssignmentBundle, pruneAssignments, decideAssignment,
  pendingAssignmentsFor, ASSIGN_MAX_ROUTINES, ASSIGN_MAX_EX, ASSIGN_PENDING_DAYS,
  sessionsOverlap, findSessionConflicts
} from './domain.mjs'

const DAY = 86400000
const NOW = Date.parse('2026-08-28T12:00:00Z')
const iso = t => new Date(t).toISOString()

/* ---------- access requests ---------- */

test('normPhone strips everything but digits', () => {
  assert.equal(normPhone(' +41 79 123-45.67 '), '41791234567')
  assert.equal(normPhone(null), '')
})

test('hasPendingPhone equates prefix conventions, pending only', () => {
  const reqs = [
    { status: 'pending', phone: '+41 79 123 45 67' },
    { status: 'rejected', phone: '0555' },
  ]
  assert.equal(hasPendingPhone(reqs, '0041791234567'), true)   // 00-prefix international
  assert.equal(hasPendingPhone(reqs, '079 123 45 67'), true)   // local 0-prefix
  assert.equal(hasPendingPhone(reqs, '079 123 45 68'), false)  // genuinely different line
  assert.equal(hasPendingPhone(reqs, '0555'), false)           // decided, not pending
})

test('pruneRequests expires pending by created, decided by decidedAt', () => {
  const reqs = [
    { id: 'a', status: 'pending', created: iso(NOW - (REQ_PENDING_DAYS - 1) * DAY) },
    { id: 'b', status: 'pending', created: iso(NOW - (REQ_PENDING_DAYS + 1) * DAY) },
    { id: 'c', status: 'approved', created: iso(NOW - 90 * DAY), decidedAt: iso(NOW - (REQ_DECIDED_DAYS - 1) * DAY) },
    { id: 'd', status: 'rejected', created: iso(NOW - 90 * DAY), decidedAt: iso(NOW - (REQ_DECIDED_DAYS + 1) * DAY) },
  ]
  assert.deepEqual(pruneRequests(reqs, NOW).map(r => r.id), ['a', 'c'])
})

test('decideRequest: approve mints exactly one code, reject mints none, re-decide errors', () => {
  let minted = 0
  const mint = () => { minted++; return 'CODE' + minted }
  const r1 = { id: 'x', status: 'pending' }
  const ok = decideRequest(r1, true, mint, NOW)
  assert.equal(ok.request.status, 'approved')
  assert.equal(ok.request.code, 'CODE1')
  assert.equal(ok.request.decidedAt, iso(NOW))
  assert.equal(decideRequest(r1, true, mint).error, 'already decided')
  const r2 = { id: 'y', status: 'pending' }
  const rej = decideRequest(r2, false, mint, NOW)
  assert.equal(rej.request.status, 'rejected')
  assert.equal(rej.request.code, undefined)
  assert.equal(minted, 1)
  assert.equal(decideRequest(undefined, true, mint).error, 'no such request')
})

/* ---------- group sessions ---------- */

test('addDaysISO steps over month and year boundaries; isRealDate rejects rollover dates', () => {
  assert.equal(addDaysISO('2026-08-28', 7), '2026-09-04')
  assert.equal(addDaysISO('2026-12-28', 7), '2027-01-04')
  assert.equal(addDaysISO('garbage', 0), '')
  assert.equal(isRealDate('2026-02-30', ), false)   // Date would roll this to March 2
  assert.equal(isRealDate('2024-02-29'), true)      // leap day is real
  assert.equal(isRealDate('2026-02-29'), false)     // ...but not in 2026
})

test('validateSession rejects what would silently vanish, clamps the rest', () => {
  assert.equal(validateSession({}).error, 'title required')
  assert.equal(validateSession({ title: 'Spin', date: '2026-02-30', time: '18:00' }).error, 'invalid date')
  assert.equal(validateSession({ title: 'Spin', date: '2026-08-28', time: '24:00' }).error, 'invalid time')
  const { session } = validateSession({ title: ' Spin ', coach: 'Ana', room: ' Studio 1 ', date: '2026-08-28', time: '18:00', minutes: 9999, capacity: '12', note: 'x' })
  assert.deepEqual(session, { title: 'Spin', date: '2026-08-28', time: '18:00', room: 'Studio 1', coach: 'Ana', minutes: 240, note: 'x', capacity: 12 })
  // capacity 0 / empty = unlimited = omitted
  assert.equal('capacity' in validateSession({ title: 'a', date: '2026-08-28', time: '06:00', capacity: 0 }).session, false)
  // coachId is the real link; it stays off the row entirely when a class has no account behind it
  // (a guest instructor), so `coach` remains the display fallback rather than a dangling id.
  const named = validateSession({ title: 'a', date: '2026-08-28', time: '06:00', coachId: 'u1' }).session
  assert.equal(named.coachId, 'u1')
  assert.equal('coachId' in validateSession({ title: 'a', date: '2026-08-28', time: '06:00' }).session, false)
  // Cancelling keeps the class on the timetable with its reason, rather than deleting it.
  const off = validateSession({ title: 'a', date: '2026-08-28', time: '06:00', cancelled: true, cancelReason: 'Coach ill' }).session
  assert.equal(off.cancelled, true)
  assert.equal(off.cancelReason, 'Coach ill')
  assert.equal('cancelled' in validateSession({ title: 'a', date: '2026-08-28', time: '06:00' }).session, false)
})

test('expandRepeats: single session gets no seriesId, weekly copies share one', () => {
  let n = 0
  const newId = () => 'id' + (++n)
  const base = { title: 'Spin', date: '2026-08-28', time: '18:00', minutes: 60 }
  const one = expandRepeats(base, 1, newId)
  assert.equal(one.length, 1)
  assert.equal(one[0].seriesId, undefined)
  const six = expandRepeats(base, 6, newId)
  assert.equal(six.length, 6)
  assert.deepEqual(six.map(s => s.date),
    ['2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02'])
  assert.equal(new Set(six.map(s => s.id)).size, 6)
  assert.equal(new Set(six.map(s => s.seriesId)).size, 1)
  assert.ok(six[0].seriesId)
})

test('expandRepeats clamps to MAX_REPEAT_WEEKS and survives junk input', () => {
  let n = 0
  const newId = () => 'id' + (++n)
  const base = { title: 'x', date: '2026-01-01', time: '06:00' }
  assert.equal(expandRepeats(base, 999, newId).length, MAX_REPEAT_WEEKS)
  assert.equal(expandRepeats(base, 'nope', newId).length, 1)
})

test('pruneSessions drops only the long-gone; sessionSort orders by date then time', () => {
  const s = [
    { id: 'old', date: addDaysISO('2026-08-28', -61) },
    { id: 'recent', date: addDaysISO('2026-08-28', -59) },
    { id: 'future', date: '2026-09-01' },
  ]
  assert.deepEqual(pruneSessions(s, '2026-08-28').map(x => x.id), ['recent', 'future'])
  const sorted = [
    { id: 'b', date: '2026-09-01', time: '18:00' },
    { id: 'a', date: '2026-09-01', time: '07:30' },
    { id: 'c', date: '2026-08-30', time: '20:00' },
  ].sort(sessionSort)
  assert.deepEqual(sorted.map(x => x.id), ['c', 'a', 'b'])
})

/* ---------- first-run bootstrap ---------- */
// The value of this helper is entirely in when it says NO, so that is what these cover.

const SECRET = 'K7QW2ZP9RM4XVT8B'   // exactly BOOTSTRAP_MIN, the shortest thing accepted

test('bootstrap: matches the configured code on an empty database', () => {
  assert.equal(bootstrapMatches(SECRET, SECRET, 0), true)
})

test('bootstrap: disarms the moment a user exists', () => {
  // The whole safety story — the window closes by itself rather than waiting for the operator
  // to remember, which is what setting INVITE_ONLY=0 by hand gets wrong.
  assert.equal(bootstrapMatches(SECRET, SECRET, 1), false)
  assert.equal(bootstrapMatches(SECRET, SECRET, 47), false)
})

test('bootstrap: unset or blank code is never armed', () => {
  for (const secret of [undefined, null, '', '   ']) {
    assert.equal(bootstrapMatches('', secret, 0), false)
    assert.equal(bootstrapMatches('ANYTHING', secret, 0), false)
  }
})

test('bootstrap: a short code is refused rather than silently weakened', () => {
  const short = 'A'.repeat(BOOTSTRAP_MIN - 1)
  assert.equal(bootstrapMatches(short, short, 0), false)
  assert.equal(bootstrapMatches('letmein', 'letmein', 0), false)
})

test('bootstrap: wrong code of the same length is rejected', () => {
  // Same length matters: it is the branch that actually reaches the constant-time compare.
  const wrong = 'K7QW2ZP9RM4XVT8C'
  assert.equal(wrong.length, SECRET.length)
  assert.equal(bootstrapMatches(wrong, SECRET, 0), false)
})

test('bootstrap: differing lengths are rejected without throwing', () => {
  // timingSafeEqual throws on unequal buffers, so the length gate has to come first.
  assert.equal(bootstrapMatches(SECRET + 'EXTRA', SECRET, 0), false)
  assert.equal(bootstrapMatches('K7QW2ZP9RM4XVT8', SECRET, 0), false)
})

test('bootstrap: case and surrounding space are forgiven, since the form upper-cases input', () => {
  assert.equal(bootstrapMatches(SECRET.toLowerCase(), SECRET, 0), true)
  assert.equal(bootstrapMatches('  ' + SECRET + '  ', SECRET, 0), true)
  assert.equal(bootstrapMatches(SECRET, SECRET.toLowerCase(), 0), true)
})

/* ---------- coaching ---------- */

const COACH = { id: 'coach1' }
const MINE = { id: 'm1', coachId: 'coach1' }
const THEIRS = { id: 'm2', coachId: 'coach2' }
const bundle = (over = {}) => ({
  opengym_plan: 1, name: 'Block A', week: { 1: 'r1' },
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 4, reps: 8 }] }],
  customEx: [], ...over
})

test('canCoachMember: only the coach’s own, active members', () => {
  assert.equal(canCoachMember(COACH, MINE), true)
  // The one that matters: another coach's member must never be reachable.
  assert.equal(canCoachMember(COACH, THEIRS), false)
  assert.equal(canCoachMember(COACH, { id: 'm3' }), false)          // unassigned
  assert.equal(canCoachMember(COACH, { ...MINE, disabled: true }), false)
  assert.equal(canCoachMember(COACH, COACH), false)                 // not yourself
  assert.equal(canCoachMember(null, MINE), false)
  assert.equal(canCoachMember(COACH, null), false)
})

test('canCoachMember: an admin reaches anyone, but still not a disabled member or themselves', () => {
  assert.equal(canCoachMember(COACH, THEIRS, { isAdmin: true }), true)
  assert.equal(canCoachMember(COACH, { ...THEIRS, disabled: true }, { isAdmin: true }), false)
  assert.equal(canCoachMember(COACH, COACH, { isAdmin: true }), false)
})

test('validateAssignmentBundle accepts a real bundle and strips unknown top-level keys', () => {
  const { bundle: out, error } = validateAssignmentBundle(bundle({ evil: 'x', workouts: [1, 2, 3] }))
  assert.equal(error, undefined)
  assert.deepEqual(Object.keys(out).sort(), ['customEx', 'name', 'opengym_plan', 'routines', 'week'])
  assert.equal(out.name, 'Block A')
})

test('validateAssignmentBundle rejects junk, empty and malformed plans', () => {
  for (const bad of [null, undefined, 'nope', [], {}, { opengym_plan: 1 }]) {
    assert.ok(validateAssignmentBundle(bad).error, `should reject ${JSON.stringify(bad)}`)
  }
  assert.ok(validateAssignmentBundle(bundle({ routines: [] })).error)
  assert.ok(validateAssignmentBundle(bundle({ routines: [{ id: 'r1' }] })).error)          // no ex array
  assert.ok(validateAssignmentBundle(bundle({ routines: [{ ex: [] }] })).error)            // no id
  assert.ok(validateAssignmentBundle(bundle({ routines: [{ id: 'r', ex: [{}] }] })).error) // ex without id
})

test('validateAssignmentBundle enforces the size caps', () => {
  const many = Array.from({ length: ASSIGN_MAX_ROUTINES + 1 }, (_, i) => ({ id: 'r' + i, ex: [] }))
  assert.ok(validateAssignmentBundle(bundle({ routines: many })).error)
  const fat = [{ id: 'r1', ex: Array.from({ length: ASSIGN_MAX_EX + 1 }, () => ({ id: '0025' })) }]
  assert.ok(validateAssignmentBundle(bundle({ routines: fat })).error)
  // A plan that is small in shape but huge in bytes still has to bounce.
  assert.ok(validateAssignmentBundle(bundle({ name: 'x'.repeat(200_000) })).error)
})

test('validateAssignmentBundle survives a circular object instead of throwing', () => {
  const circular = bundle()
  circular.self = circular
  assert.ok(validateAssignmentBundle(circular).error)
})

test('decideAssignment answers once and records when', () => {
  const a = { status: 'pending' }
  assert.equal(decideAssignment(a, true, 1000).assignment.status, 'accepted')
  assert.equal(a.decidedAt, new Date(1000).toISOString())
  assert.ok(decideAssignment(a, false).error)            // already decided
  assert.equal(decideAssignment({ status: 'pending' }, false).assignment.status, 'declined')
  assert.ok(decideAssignment(null, true).error)
})

test('pendingAssignmentsFor isolates one member’s pending offers', () => {
  const all = [
    { memberId: 'm1', status: 'pending' }, { memberId: 'm1', status: 'accepted' },
    { memberId: 'm2', status: 'pending' }
  ]
  assert.equal(pendingAssignmentsFor(all, 'm1').length, 1)
  assert.equal(pendingAssignmentsFor(all, 'nobody').length, 0)
  assert.equal(pendingAssignmentsFor(null, 'm1').length, 0)
})

test('pruneAssignments drops the long-expired and keeps the fresh', () => {
  const now = Date.parse('2026-09-01T00:00:00Z')
  const iso = d => new Date(now - d * 86400000).toISOString()
  const kept = pruneAssignments([
    { status: 'pending', created: iso(1) },
    { status: 'pending', created: iso(ASSIGN_PENDING_DAYS + 1) },
    { status: 'accepted', created: iso(400), decidedAt: iso(2) },
    { status: 'declined', created: iso(400), decidedAt: iso(999) }
  ], now)
  assert.equal(kept.length, 2)
  assert.equal(pruneAssignments(null, now).length, 0)
})

/* ---------- timetable clashes ---------- */
// A club running spin, yoga and Zumba in separate studios needs exactly two rules: one room
// holds one class, and one coach teaches one class. Nothing enforced either before.

const cls = (o = {}) => ({
  id: 'x', title: 'Spin', date: '2026-09-10', time: '18:00', minutes: 45, room: 'Studio 1', ...o
})

test('sessionsOverlap: only a real time collision on the same day', () => {
  assert.equal(sessionsOverlap(cls(), cls({ time: '18:30' })), true)      // starts mid-class
  assert.equal(sessionsOverlap(cls(), cls({ time: '17:30' })), true)      // ends mid-class
  assert.equal(sessionsOverlap(cls(), cls({ time: '18:00' })), true)      // exactly together
  // Half-open: back-to-back classes are the normal timetable, not a clash.
  assert.equal(sessionsOverlap(cls(), cls({ time: '18:45' })), false)
  assert.equal(sessionsOverlap(cls(), cls({ time: '17:15' })), false)
  assert.equal(sessionsOverlap(cls(), cls({ date: '2026-09-11' })), false)
  assert.equal(sessionsOverlap(cls(), cls({ time: 'nonsense' })), false)
})

test('conflicts: same room at the same time is caught, a different room is not', () => {
  const existing = [cls({ id: 'a' })]
  const clash = findSessionConflicts(existing, cls({ id: 'b', title: 'Yoga', time: '18:15' }))
  assert.equal(clash.length, 1)
  assert.equal(clash[0].why, 'room')
  assert.equal(clash[0].title, 'Spin')
  assert.equal(findSessionConflicts(existing, cls({ id: 'b', room: 'Studio 2', time: '18:15' })).length, 0)
})

test('conflicts: room matching survives spacing and capitalisation', () => {
  const existing = [cls({ id: 'a', room: 'Studio 1' })]
  assert.equal(findSessionConflicts(existing, cls({ id: 'b', room: '  studio   1 ' })).length, 1)
})

test('conflicts: a coach cannot be in two rooms at once', () => {
  const existing = [cls({ id: 'a', room: 'Studio 1', coachId: 'ana' })]
  const clash = findSessionConflicts(existing, cls({ id: 'b', room: 'Studio 2', coachId: 'ana', time: '18:15' }))
  assert.equal(clash.length, 1)
  assert.equal(clash[0].why, 'coach')
  // A different coach in a different room at the same hour is the normal case.
  assert.equal(findSessionConflicts(existing, cls({ id: 'b', room: 'Studio 2', coachId: 'bob' })).length, 0)
})

test('conflicts: a blank room never collides with another blank room', () => {
  // Otherwise every unroomed class would clash with every other one at the same time.
  const existing = [cls({ id: 'a', room: '' })]
  assert.equal(findSessionConflicts(existing, cls({ id: 'b', room: '' })).length, 0)
})

test('conflicts: never reports the session against itself, nor a cancelled one', () => {
  const existing = [cls({ id: 'a' })]
  assert.equal(findSessionConflicts(existing, cls({ id: 'a' })).length, 0)
  assert.equal(findSessionConflicts([cls({ id: 'a', cancelled: true })], cls({ id: 'b' })).length, 0)
  assert.equal(findSessionConflicts(existing, cls({ id: 'b', cancelled: true })).length, 0)
})

test('conflicts: a series save ignores its own siblings', () => {
  // Every weekly copy shares a room and time, so without this a 26-week series would report
  // 25 clashes against itself the moment anyone edited it.
  const series = [cls({ id: 'a', seriesId: 'S' }), cls({ id: 'b', seriesId: 'S', date: '2026-09-17' })]
  assert.equal(findSessionConflicts(series, cls({ id: 'c', seriesId: 'S' }), { skipSeriesId: 'S' }).length, 0)
  assert.equal(findSessionConflicts(series, cls({ id: 'c' })).length, 1)
})

test('conflicts: tolerates junk input rather than throwing', () => {
  assert.deepEqual(findSessionConflicts(null, cls()), [])
  assert.deepEqual(findSessionConflicts([null, undefined], cls()), [])
  assert.deepEqual(findSessionConflicts([cls()], null), [])
})
