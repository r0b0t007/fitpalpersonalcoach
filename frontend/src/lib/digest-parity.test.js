// The shared cases behind the coach's morning digest (digest-parity.json), run against the rules
// the server ports: backend tests/Unit/DigestParityTest.php runs the same file against its copy.
import { describe, it, expect } from 'vitest'
import cases from './digest-parity.json'
import { checkinOverdue } from './checkins.js'
import { adherenceOf } from './adherence.js'

describe('digest parity cases', () => {
  it.each(cases.checkinOverdue)('checkinOverdue day $checkinDay, last $lastCheckin, on $today', c => {
    expect(checkinOverdue({ checkinDay: c.checkinDay, lastCheckin: c.lastCheckin }, c.today)).toBe(c.overdue)
  })
  it.each(cases.missed)('missed: $name', c => {
    expect(adherenceOf(c.parts, c.today, c.days).missed).toBe(c.missed)
  })
})
