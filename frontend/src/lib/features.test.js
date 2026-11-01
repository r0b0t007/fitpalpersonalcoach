import { describe, it, expect } from 'vitest'
import { COACHED_HIDES, can, isCoached } from './features.js'

// CHW-333: a coached client's app hides what undoes the coach's program; everyone else keeps all.
const coached = { id: 'c1', name: 'Salma', coachName: 'Yasmine' }
const solo = { id: 's1', name: 'Sam', coachName: null }
const coach = { id: 'k1', name: 'Yasmine', coach: true, coachName: null }
// A coach who is also someone's client (an admin, say) trains on their own terms.
const coachWithCoach = { ...coach, coachName: 'Other' }

describe('features', () => {
  it('counts as coached only a client with a coach who is not a coach', () => {
    expect([coached, solo, coach, coachWithCoach, null, undefined].map(isCoached)).toEqual([true, false, false, false, false, false])
  })

  it('hides every listed feature from a coached client, and none from anyone else', () => {
    for (const f of Object.keys(COACHED_HIDES)) {
      expect(can(coached, f)).toBe(false)
      for (const u of [solo, coach, coachWithCoach, null]) expect(can(u, f)).toBe(true)
    }
  })

  it('gives everything back once the coach releases them', () => {
    const released = { ...coached, coachName: null }
    expect(Object.keys(COACHED_HIDES).every(f => can(released, f))).toBe(true)
  })

  it('never hides what is not on the list: export, the swap, their own charts', () => {
    for (const f of ['export', 'swapExercise', 'stats', 'nutrition', 'history']) expect(can(coached, f)).toBe(true)
  })
})
