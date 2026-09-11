// The attention list is the first thing a coach sees, and it is all judgement: which client,
// for which reason, in what order. Each reason is pinned with the smallest member that triggers
// it, and the ranking with members that trigger several — because the list shows one row per
// person, the wrong winner hides a real problem behind a lesser one.
import { describe, it, expect } from 'vitest'
import { attentionItems, reasonFor, daysSince } from './roster-attention.js'

const TODAY = '2026-09-10'   // a Thursday; the default check-in day is Sunday (0)
const base = {
  id: 'm', name: 'Sara', created: '2026-01-01T00:00:00.000Z', disabled: false,
  workouts: 40, lastWorkout: '2026-09-09', lastSync: 1, live: null,
  pending: [], lastDecision: null, routines: 3, checkinDay: null, lastCheckin: '2026-09-06',
}
const with_ = over => ({ ...base, ...over })

describe('daysSince', () => {
  it('reads an ISO day, an ISO timestamp, or milliseconds', () => {
    expect(daysSince('2026-09-08', TODAY)).toBe(2)
    expect(daysSince('2026-09-08T23:59:00.000Z', TODAY)).toBe(2)
    expect(daysSince(Date.parse('2026-09-03T12:00:00Z'), TODAY)).toBe(7)
    expect(daysSince(null, TODAY)).toBeNull()
  })
})

describe('one reason per client', () => {
  it('a client with nothing wrong is not on the list', () => {
    expect(reasonFor(base, TODAY)).toBeNull()
    expect(attentionItems([base], TODAY)).toEqual([])
  })
  it('an unanswered program outranks everything', () => {
    const m = with_({ pending: [{ id: 'a', created: '2026-09-07T10:00:00.000Z' }], lastWorkout: null, routines: 0 })
    expect(reasonFor(m, TODAY)).toMatchObject({ type: 'program-waiting', detail: 'Sent 3 days ago' })
  })
  it('a decline is next', () => {
    const m = with_({ lastDecision: { status: 'declined', at: '2026-09-09T10:00:00.000Z' }, routines: 0 })
    expect(reasonFor(m, TODAY)).toMatchObject({ type: 'declined', detail: 'yesterday' })
  })
  it('a new client with no program is the coach’s job today', () => {
    const m = with_({ created: '2026-09-08T09:00:00.000Z', routines: 0, workouts: 0, lastWorkout: null, lastCheckin: null })
    expect(reasonFor(m, TODAY)).toMatchObject({ type: 'new-client', detail: 'Joined 2 days ago' })
  })
  it('an old client with no program is "no program", not "new"', () => {
    const m = with_({ routines: 0 })
    expect(reasonFor(m, TODAY)).toMatchObject({ type: 'no-program' })
  })
  it('a check-in owed for this period and not filed', () => {
    // Period started Sunday the 6th; their last one is from the period before.
    const m = with_({ lastCheckin: '2026-09-05' })
    expect(reasonFor(m, TODAY)).toMatchObject({ type: 'checkin-overdue', detail: 'Last one 5 days ago' })
    expect(reasonFor(with_({ lastCheckin: null }), TODAY)).toMatchObject({ type: 'checkin-overdue', detail: 'None filed yet' })
  })
  it('respects the client’s own check-in day', () => {
    // Check-in day Wednesday (3): the period started the 9th, and a check-in on the 8th is late.
    expect(reasonFor(with_({ checkinDay: 3, lastCheckin: '2026-09-08' }), TODAY)?.type).toBe('checkin-overdue')
    expect(reasonFor(with_({ checkinDay: 3, lastCheckin: '2026-09-09' }), TODAY)).toBeNull()
  })
  it('a week without training, unless they are training right now', () => {
    expect(reasonFor(with_({ lastWorkout: '2026-09-03' }), TODAY)).toMatchObject({ type: 'inactive', detail: 'Last workout 7 days ago' })
    expect(reasonFor(with_({ lastWorkout: '2026-09-04' }), TODAY)).toBeNull()
    expect(reasonFor(with_({ lastWorkout: '2026-09-01', live: { name: 'Push', startedAt: 1 } }), TODAY)).toBeNull()
  })
})

describe('the list', () => {
  it('is most pressing first, then by name, and skips disabled accounts', () => {
    const items = attentionItems([
      with_({ id: 'a', name: 'Zed', lastWorkout: '2026-08-01' }),
      with_({ id: 'b', name: 'Amy', lastWorkout: '2026-08-01' }),
      with_({ id: 'c', name: 'Bob', pending: [{ id: 'p', created: '2026-09-09T00:00:00.000Z' }] }),
      with_({ id: 'd', name: 'Gone', disabled: true, routines: 0 }),
    ], TODAY)
    expect(items.map(i => i.id)).toEqual(['c', 'b', 'a'])
    expect(items[0]).toMatchObject({ name: 'Bob', type: 'program-waiting' })
  })
})
