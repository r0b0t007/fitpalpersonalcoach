import { describe, it, expect } from 'vitest'
import { applyStarter } from './starter-accept.js'
import { effectiveRoutineIds } from './history.js'

// A coach's starter program (CHW-338): taken in by the app itself, so workout 1 is there the day
// the client joins. This decides what they lift first, so every case it meets is pinned here.

const TODAY = '2026-11-04'   // a Wednesday (3)
// As parsePlan hands it over: routines with their exercises, and the week by weekday.
const bundle = (week = { 1: ['a'], 4: ['b'] }) => ({
  routines: [
    { id: 'a', name: 'Haut du corps', ex: [{ id: '0025', sets: 3 }] },
    { id: 'b', name: 'Bas du corps', ex: [{ id: '0043', sets: 3 }] },
  ],
  week, customEx: [],
})
const fresh = () => ({ routines: [], week: {}, dayPlan: {}, customEx: [], workouts: [] })

describe('applyStarter', () => {
  it('puts the first routine on today when today is a rest day in the program', () => {
    const s = fresh()
    const id = applyStarter(s, bundle(), TODAY)
    expect(s.routines.map(r => r.name)).toEqual(['Haut du corps', 'Bas du corps'])
    expect(id).toBe(s.routines[0].id)
    expect(effectiveRoutineIds(s, TODAY)).toEqual([s.routines[0].id])
    // The program's own week is kept for the days after: Monday and Thursday.
    expect(s.week[1]).toEqual([s.routines[0].id])
    expect(s.week[4]).toEqual([s.routines[1].id])
  })

  it('leaves today alone when the program already trains on it', () => {
    const s = fresh()
    expect(applyStarter(s, bundle({ 3: ['b'] }), TODAY)).toBe(null)
    expect(s.dayPlan).toEqual({})
    expect(effectiveRoutineIds(s, TODAY)).toEqual([s.routines[1].id])
  })

  it('replaces nothing a returning client already has: their week, targets and check-in day', () => {
    const s = { ...fresh(), routines: [{ id: 'mine', name: 'Mine', ex: [{ id: '0001', sets: 3 }] }], week: { 1: ['mine'] },
      nutriTarget: { kcal: 2000, t: 1 }, checkinDay: 3 }
    applyStarter(s, { ...bundle(), nutrition: { kcal: 2600 }, checkinDay: 0 }, TODAY)
    expect(s.week).toEqual({ 1: ['mine'] })
    expect(s.nutriTarget).toEqual({ kcal: 2000, t: 1 })
    expect(s.checkinDay).toBe(3)
    // Their week trains Mondays only, so today still gets the program's first routine.
    expect(effectiveRoutineIds(s, TODAY)).toEqual([s.routines[1].id])
  })

  it('keeps a client\'s own routines, and adds the program\'s beside them', () => {
    const s = { ...fresh(), routines: [{ id: 'mine', name: 'Mine', ex: [{ id: '0001', sets: 3 }] }], week: { 3: ['mine'] } }
    expect(applyStarter(s, bundle({}), TODAY)).toBe(null)   // today already has their own session
    expect(s.routines.map(r => r.name)).toEqual(['Mine', 'Haut du corps', 'Bas du corps'])
    expect(s.week[3]).toEqual(['mine'])   // an empty program week does not wipe theirs
  })

  it('gives today the program\'s first routine when the program has no week at all', () => {
    const s = fresh()
    applyStarter(s, bundle({}), TODAY)
    expect(effectiveRoutineIds(s, TODAY)).toEqual([s.routines[0].id])
  })

  it('skips a routine with nothing in it, and never overrides a day the client said is rest', () => {
    const empty = { routines: [{ id: 'x', name: 'Vide', ex: [] }, ...bundle({}).routines], week: {}, customEx: [] }
    const s = fresh()
    applyStarter(s, empty, TODAY)
    expect(s.dayPlan[TODAY]).toBe(s.routines[1].id)
    const rest = { ...fresh(), dayPlan: { [TODAY]: 'rest' } }
    expect(applyStarter(rest, bundle({}), TODAY)).toBe(null)
    expect(rest.dayPlan[TODAY]).toBe('rest')
  })
})
