import { describe, it, expect } from 'vitest'
import { HEALTH_KEYS, emptyHealth, mustAsk } from './health-consent.js'

describe('health consent', () => {
  it('asks a coach’s client who has not agreed, and nobody else', () => {
    expect(mustAsk({ required: true, consentAt: null })).toBe(true)
    expect(mustAsk({ required: true, consentAt: 1 })).toBe(false)
    expect(mustAsk({ required: false, consentAt: null })).toBe(false)
    expect(mustAsk(null)).toBe(false)   // not known yet: the caller asks the server first
  })

  it('empties every health key and leaves training alone', () => {
    const s = { workouts: [{ d: '2026-10-30' }], bodyweight: [1], measurements: [1], checkins: [1], meals: [1], mealDays: { a: 1 } }
    emptyHealth(s)
    expect(Object.fromEntries(HEALTH_KEYS.map(k => [k, s[k]]))).toEqual({ bodyweight: [], measurements: [], checkins: [], meals: [], mealDays: {} })
    expect(s.workouts).toHaveLength(1)
  })

  it('takes the weigh-in off every workout, the open one too, and keeps the workout', () => {
    const s = { workouts: [{ d: '2026-10-30', bw: 82.4, bwUnit: 'kg', vol: 900 }, { d: '2026-10-31', bodyweight: 82 }], active: { id: 'a', bw: 82.1 } }
    emptyHealth(s)
    expect(s.workouts).toEqual([{ d: '2026-10-30', vol: 900 }, { d: '2026-10-31' }])
    expect(s.active).toEqual({ id: 'a' })
  })
})
