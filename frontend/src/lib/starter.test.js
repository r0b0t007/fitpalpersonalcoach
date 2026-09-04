// The registry is data, and the failure mode of bad data here is silent: an exercise id that
// resolves to nothing renders as "Unknown exercise" inside someone's loaded plan, with no error
// anywhere. These walk every program so a typo cannot ship.
import { describe, it, expect } from 'vitest'
import { PROGRAMS, programById, programRoutines, programSchedule, starterRoutines } from './starter.js'
import { EXIDX } from './exercises.js'
import { ICON_NAMES } from '../components/Icon.jsx'

describe('program registry', () => {
  it('every exercise id resolves to a real catalogue entry', () => {
    const bad = []
    for (const p of PROGRAMS) {
      for (const [name, , list] of p.routines) {
        for (const [exId] of list) if (!EXIDX[exId]) bad.push(`${p.id} / ${name} / ${exId}`)
      }
    }
    // Named rather than counted, so a failure says which id in which routine.
    expect(bad).toEqual([])
  })

  it('every glyph is one the icon set can render', () => {
    const bad = []
    for (const p of PROGRAMS) {
      for (const [name, glyph] of p.routines) if (!ICON_NAMES.includes(glyph)) bad.push(`${p.id} / ${name} / ${glyph}`)
    }
    expect(bad).toEqual([])
  })

  it('every scheduled day is a real weekday, and there is one slot per day', () => {
    for (const p of PROGRAMS) {
      expect(p.days.length, p.id + ' days').toBeGreaterThan(0)
      for (const d of p.days) expect(d, p.id + ' weekday').toBeGreaterThanOrEqual(0)
      for (const d of p.days) expect(d, p.id + ' weekday').toBeLessThanOrEqual(6)
      expect(new Set(p.days).size, p.id + ' duplicate weekday').toBe(p.days.length)
      // A day with no routine to put on it would silently schedule nothing.
      expect(programSchedule(p.id).length, p.id + ' schedule length').toBe(p.days.length)
    }
  })

  it('every schedule slot points at a routine the program actually has', () => {
    for (const p of PROGRAMS) {
      for (const i of programSchedule(p.id)) {
        expect(i, p.id + ' schedule index').toBeGreaterThanOrEqual(0)
        expect(i, p.id + ' schedule index').toBeLessThan(p.routines.length)
      }
    }
  })

  it('sets and reps are sane numbers', () => {
    for (const p of PROGRAMS) {
      for (const [name, , list] of p.routines) {
        expect(list.length, `${p.id} / ${name} is empty`).toBeGreaterThan(0)
        for (const [exId, sets, reps] of list) {
          expect(sets, `${p.id}/${name}/${exId} sets`).toBeGreaterThan(0)
          expect(sets, `${p.id}/${name}/${exId} sets`).toBeLessThanOrEqual(10)
          expect(reps, `${p.id}/${name}/${exId} reps`).toBeGreaterThan(0)
          expect(reps, `${p.id}/${name}/${exId} reps`).toBeLessThanOrEqual(30)
        }
      }
    }
  })

  it('ids are unique, so programById cannot be ambiguous', () => {
    expect(new Set(PROGRAMS.map(p => p.id)).size).toBe(PROGRAMS.length)
  })
})

describe('programRoutines', () => {
  it('hands back fresh ids each call, so loading twice gives independent copies', () => {
    const a = programRoutines('fullbody')
    const b = programRoutines('fullbody')
    expect(a).toHaveLength(3)
    expect(a.map(r => r.id)).not.toEqual(b.map(r => r.id))
    expect(new Set([...a, ...b].map(r => r.id)).size).toBe(6)
  })

  it('carries the program-level progression rule onto each routine', () => {
    // For 5×5 the progression rule is the program; losing it would leave a plain 5×5 that
    // never adds weight.
    for (const r of programRoutines('strength5x5')) expect(r.prog).toBe('linear')
    // Programs without one stay unset, so the app's own default applies.
    for (const r of programRoutines('fullbody')) expect(r.prog).toBeUndefined()
  })

  it('produces entries the workout screen can log against', () => {
    for (const r of programRoutines('upperlower')) {
      for (const e of r.ex) {
        expect(typeof e.id).toBe('string')
        expect(e.weight).toBe(0)
        expect(e.sets).toBeGreaterThan(0)
        expect(e.reps).toBeGreaterThan(0)
      }
    }
  })

  it('returns nothing for an unknown program rather than throwing', () => {
    expect(programRoutines('nope')).toEqual([])
    expect(programSchedule('nope')).toEqual([])
    expect(programById('nope')).toBeUndefined()
  })
})

describe('starterRoutines stays exactly what demoSeed expects', () => {
  // demoSeed.js destructures [push, pull, legs] and keys a starting-weight table off these exact
  // exercise ids. Changing the PPL spec silently breaks the demo build, which nothing else tests.
  it('is still three routines in push/pull/legs order', () => {
    const r = starterRoutines()
    expect(r.map(x => x.name)).toEqual(['Push Day', 'Pull Day', 'Leg Day'])
  })

  it('still uses the original exercise ids', () => {
    const [push, pull, legs] = starterRoutines()
    expect(push.ex.map(e => e.id)).toEqual(['0025', '0047', '0426', '0334', '0241', '0251'])
    expect(pull.ex.map(e => e.id)).toEqual(['2330', '0027', '1323', '0031', '0313'])
    expect(legs.ex.map(e => e.id)).toEqual(['0043', '0085', '0739', '0585', '0586', '0605'])
  })
})
