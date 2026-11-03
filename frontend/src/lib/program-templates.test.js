import { afterAll, describe, expect, it } from 'vitest'
import { EXIDX, isCardio } from './exercises.js'
import { _setLangState } from './i18n-core.js'
import fr from '../locales/fr.js'
import { programTemplates, templateProgram } from './program-templates.js'

const KEYS = ['full-body', 'ppl', 'home', 'glutes', 'ramadan']

// PlanBundle::validate and cleanProgram, the server's gate on every library save: a template the
// server would refuse is a button that only ever shows an error.
const MAX_ROUTINES = 20, MAX_EX = 60, NAME_MAX = 60, MAX_BYTES = 128 * 1024

describe('program templates', () => {
  afterAll(() => _setLangState('en'))

  it('offers the five programs a new coach needs on day one, with their days a week', () => {
    expect(programTemplates().map(p => [p.key, p.days])).toEqual([
      ['full-body', 3], ['ppl', 6], ['home', 3], ['glutes', 3], ['ramadan', 3],
    ])
    expect(templateProgram('nope')).toBeNull()
  })

  it.each(KEYS)('%s is a bundle the server saves', key => {
    const { name, bundle } = templateProgram(key)
    expect(name.length).toBeGreaterThan(0)
    expect(name.length).toBeLessThanOrEqual(NAME_MAX)
    expect(bundle.opengym_plan).toBeTruthy()
    expect(bundle.routines.length).toBeGreaterThan(0)
    expect(bundle.routines.length).toBeLessThanOrEqual(MAX_ROUTINES)
    for (const r of bundle.routines) {
      expect(r.id).toBeTruthy()
      expect(r.ex.length).toBeGreaterThan(0)
      expect(r.ex.length).toBeLessThanOrEqual(MAX_EX)
      for (const e of r.ex) {
        // A real library exercise, logged as reps: a cardio-tagged one would ask for minutes.
        expect(e.id in EXIDX, `${key}: ${e.id}`).toBe(true)
        expect(isCardio(e.id), `${key}: ${e.id} is cardio`).toBe(false)
        expect(e.sets).toBeGreaterThan(0)
        expect(e.reps).toBeGreaterThan(0)
      }
    }
    expect(JSON.stringify(bundle).length).toBeLessThan(MAX_BYTES)
  })

  it.each(KEYS)('%s schedules every routine, and only routines it contains', key => {
    const { bundle } = templateProgram(key)
    const ids = new Set(bundle.routines.map(r => r.id))
    const scheduled = Object.values(bundle.week).flat()
    expect(scheduled.every(id => ids.has(id))).toBe(true)
    expect(new Set(scheduled)).toEqual(ids)
  })

  it('makes a fresh copy every time, so two copies never share a routine id', () => {
    const a = templateProgram('home').bundle.routines.map(r => r.id)
    const b = templateProgram('home').bundle.routines.map(r => r.id)
    expect(a.some(id => b.includes(id))).toBe(false)
  })

  it('keeps per-side counts and the coaching notes in the copy', () => {
    const [a] = templateProgram('home').bundle.routines
    const split = a.ex.find(e => e.id === '2368')
    expect(split).toMatchObject({ side: true, reps: 20, note: 'Back foot on a chair or the sofa.' })
  })

  it("writes the copy in the coach's language: it is stored data the client reads", () => {
    _setLangState('fr', fr)
    const { name, bundle } = templateProgram('ramadan')
    expect(name).toBe('Ramadan, après l’iftar')
    expect(bundle.routines.map(r => r.name)).toEqual(['Après l’iftar A', 'Après l’iftar B'])
    expect(bundle.routines[0].ex[0].note).toMatch(/^Commencez 1 h 30/)
  })
})
