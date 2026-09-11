// checkinOverdue is isCheckinDue for the coach's roster, which carries a member's check-in day
// and newest check-in date but not their state. The two must agree on the day, or the coach's
// list says "overdue" while the member's own Home says nothing is owed yet.
import { describe, it, expect } from 'vitest'
import { checkinOverdue, isCheckinDue } from './checkins.js'

const THU = '2026-09-10'   // check-in periods: default Sunday (0)

describe('checkinOverdue', () => {
  it('is owed when nothing has been filed since the period started', () => {
    expect(checkinOverdue({ checkinDay: null, lastCheckin: '2026-09-05' }, THU)).toBe(true)   // last Saturday, before Sunday the 6th
    expect(checkinOverdue({ checkinDay: null, lastCheckin: null }, THU)).toBe(true)
  })
  it('is not owed once one is filed for this period', () => {
    expect(checkinOverdue({ checkinDay: null, lastCheckin: '2026-09-06' }, THU)).toBe(false)
    expect(checkinOverdue({ checkinDay: null, lastCheckin: '2026-09-10' }, THU)).toBe(false)
  })
  it('follows the member’s own check-in day', () => {
    expect(checkinOverdue({ checkinDay: 4, lastCheckin: '2026-09-09' }, THU)).toBe(true)    // Thursday period started today
    expect(checkinOverdue({ checkinDay: 4, lastCheckin: '2026-09-10' }, THU)).toBe(false)
  })
  it('agrees with the member’s own isCheckinDue for the same facts', () => {
    for (const [day, last] of [[null, '2026-09-05'], [null, '2026-09-06'], [3, '2026-09-08'], [3, '2026-09-09'], [0, null]]) {
      const S = { checkinDay: day, checkins: last ? [{ d: last }] : [] }
      expect(checkinOverdue({ checkinDay: day, lastCheckin: last }, THU)).toBe(isCheckinDue(S, THU))
    }
  })
})
