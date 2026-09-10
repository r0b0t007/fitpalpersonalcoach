import { describe, expect, it } from 'vitest'
import { isoOf } from './format.js'
import { buildCheckinNotifications, buildReminderNotifications } from './mobile.js'

const push = { id: 'push', name: 'Push' }
const pull = { id: 'pull', name: 'Pull' }
const legs = { id: 'legs', name: 'Legs' }
const state = (patch = {}) => ({
  routines: [push, pull, legs], week: {}, dayPlan: {}, workouts: [],
  reminder: { on: true, time: '08:00' }, ...patch,
})
const iso = d => isoOf(d)

describe('buildReminderNotifications', () => {
  it('expands the weekly baseline into future dated notifications', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push', 3: 'pull' } }), now)

    expect(notifications.slice(0, 2).map(n => iso(n.schedule.at))).toEqual([
      iso(now), iso(new Date(2026, 5, 3)),
    ])
    expect(notifications[0].body).toContain('Push')
    expect(notifications[0].schedule.allowWhileIdle).toBe(true)
  })

  it('uses rest today and a routine override tomorrow when rescheduling', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const today = iso(now), tomorrow = iso(new Date(2026, 5, 2))
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, dayPlan: { [today]: 'rest', [tomorrow]: 'pull' },
    }), now)

    expect(notifications.slice(0, 1).map(n => [iso(n.schedule.at), n.body])).toEqual([
      [tomorrow, expect.stringContaining('Pull')],
    ])
  })

  it('schedules a valid override on a weekly rest day', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const wednesday = new Date(2026, 5, 3)
    const notifications = buildReminderNotifications(state({ dayPlan: { [iso(wednesday)]: 'legs' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(wednesday) && n.body.includes('Legs'))).toBe(true)
  })

  it('suppresses dates that already have a completed workout', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, workouts: [{ d: iso(now) }],
    }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
  })

  it("skips today's reminder after the configured local time has passed", () => {
    const now = new Date(2026, 5, 1, 9, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
    expect(notifications.some(n => iso(n.schedule.at) === iso(new Date(2026, 5, 8)))).toBe(true)
  })

  it('names both routines of a combined day, and reads a legacy scalar day the same', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const combined = buildReminderNotifications(state({ week: { 1: ['push', 'pull'] } }), now)[0]
    expect(combined.body).toContain('Push + Pull')

    const legacy = buildReminderNotifications(state({ week: { 1: 'push' } }), now)[0]
    expect(legacy.body).toContain('Push')
  })

  it('falls back to a count for three or more routines on one day', () => {
    const now = new Date(2026, 5, 1, 7, 0)
    const n = buildReminderNotifications(state({ week: { 1: ['push', 'pull', 'legs'] } }), now)[0]
    expect(n.body).toContain('3 routines')
  })
})
// The standalone app never subscribes to web push — it schedules native local notifications — so
// the server's reminder loop skips it entirely and this is the only path the nudge has on a phone.
describe('buildCheckinNotifications', () => {
  // 2026-06-01 is a Monday; checkinDay 3 is Wednesday.
  const now = new Date(2026, 5, 1, 7, 0)

  it('schedules one per week, on the check-in day only', () => {
    const out = buildCheckinNotifications(state({ checkinDay: 3, checkins: [] }), now)
    expect(out.length).toBeGreaterThan(4)
    for (const n of out) expect(n.schedule.at.getDay()).toBe(3)
    // Consecutive entries are a week apart, not a day: this is the difference between a nudge
    // and nagging, and the whole reason the push has a weekly budget.
    expect(out[1].schedule.at - out[0].schedule.at).toBe(7 * 24 * 3600 * 1000)
  })

  it('fires whether or not anything is planned that day', () => {
    // Deliberately unlike the workout reminder, which returns early on a rest day. A check-in is
    // owed whether or not they trained — that is the point of asking.
    const out = buildCheckinNotifications(state({ checkinDay: 3, checkins: [], week: {}, workouts: [] }), now)
    expect(out.length).toBeGreaterThan(0)
  })

  it('is silent when reminders are off', () => {
    expect(buildCheckinNotifications(state({ checkinDay: 3, reminder: { on: false, time: '08:00' } }), now)).toEqual([])
  })

  it('uses its own id block so it cannot collide with the workout reminder', () => {
    const a = buildReminderNotifications(state({ week: { 1: 'push', 3: 'pull' } }), now).map(n => n.id)
    const b = buildCheckinNotifications(state({ checkinDay: 3, checkins: [] }), now).map(n => n.id)
    expect(a.filter(id => b.includes(id))).toEqual([])
  })

  it('skips a check-in that has already been filed for this period', () => {
    // Only ever suppresses today's: nothing can be filed for a future date.
    const wed = new Date(2026, 5, 3)
    const out = buildCheckinNotifications(
      state({ checkinDay: 3, checkins: [{ d: iso(wed) }] }), new Date(2026, 5, 3, 7, 0))
    expect(out.map(n => iso(n.schedule.at))).not.toContain(iso(wed))
  })
})
