// node --test — pure-logic tests for the access-request and group-session helpers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normPhone, hasPendingPhone, pruneRequests, decideRequest,
  addDaysISO, isRealDate, validateSession, expandRepeats, pruneSessions, sessionSort,
  REQ_PENDING_DAYS, REQ_DECIDED_DAYS, MAX_REPEAT_WEEKS
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
  const { session } = validateSession({ title: ' Spin ', coach: 'Ana', date: '2026-08-28', time: '18:00', minutes: 9999, capacity: '12', note: 'x' })
  assert.deepEqual(session, { title: 'Spin', date: '2026-08-28', time: '18:00', coach: 'Ana', minutes: 240, note: 'x', capacity: 12 })
  // capacity 0 / empty = unlimited = omitted
  assert.equal('capacity' in validateSession({ title: 'a', date: '2026-08-28', time: '06:00', capacity: 0 }).session, false)
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
