import { describe, it, expect } from 'vitest'
import { HEALTH_KEYS, emptyHealth, mustAsk } from './health-consent.js'

describe('health consent', () => {
  it('asks a coach\u2019s client who has not agreed, and nobody else', () => {
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
})
