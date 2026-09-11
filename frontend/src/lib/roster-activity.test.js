import { describe, it, expect } from 'vitest'
import { activityFeed } from './roster-activity.js'

const NOW = Date.parse('2026-09-10T18:00:00Z')

describe('activityFeed', () => {
  it('merges the roster’s dates into one newest-first list, one entry per kind per client', () => {
    const feed = activityFeed([
      { id: 'a', name: 'Sara', lastWorkout: '2026-09-10', lastCheckin: '2026-09-07', created: '2026-01-01T00:00:00.000Z',
        lastDecision: { status: 'accepted', at: '2026-09-09T08:00:00.000Z' }, live: null },
      { id: 'b', name: 'Youssef', lastWorkout: '2026-09-08', live: { name: 'Legs', startedAt: NOW - 600000 }, created: '2026-09-09T12:00:00.000Z' },
    ], { now: NOW })
    expect(feed.map(e => [e.name, e.kind])).toEqual([
      ['Youssef', 'live'], ['Sara', 'workout'], ['Youssef', 'joined'], ['Sara', 'accepted'], ['Youssef', 'workout'], ['Sara', 'checkin'], ['Sara', 'joined'],
    ])
    expect(feed[0].text).toBe('Training now · Legs')
    expect(feed[3].text).toBe('Accepted a program')
  })
  it('caps the list, drops disabled accounts and dates from the future', () => {
    const feed = activityFeed([
      { id: 'a', name: 'A', lastWorkout: '2026-09-10', created: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'B', lastWorkout: '2026-12-25', created: '2026-01-01T00:00:00.000Z' },
      { id: 'c', name: 'C', disabled: true, lastWorkout: '2026-09-10' },
    ], { now: NOW, limit: 2 })
    // b's workout is in December; its "joined" ties with a's on the same day and stable sort
    // keeps roster order, so the two survivors are a's workout and a's joining.
    expect(feed.map(e => e.id + ':' + e.kind)).toEqual(['a:workout', 'a:joined'])
  })
  it('is empty for an empty roster', () => {
    expect(activityFeed([], { now: NOW })).toEqual([])
    expect(activityFeed(null, { now: NOW })).toEqual([])
  })
})
