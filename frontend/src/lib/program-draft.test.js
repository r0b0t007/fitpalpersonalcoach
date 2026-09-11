// A program is edited for weeks and sent once. Every failure here is quiet at the time and loud
// later: a schedule that points at a routine that no longer exists, a custom exercise whose
// definition never made it into the bundle, a rename that dropped the client's daily targets.
import { describe, it, expect } from 'vitest'
import {
  newProgramDraft, draftFromProgram, bundleOf, patchRoutine, addRoutine, removeRoutine,
  toggleDay, canRemoveRoutine, scheduledDays,
} from './program-draft.js'

const routine = (id, name, ex = []) => ({ id, name, emoji: 'figureStrength', ex })
const program = over => ({
  id: 'p1', name: 'Block A',
  bundle: {
    opengym_plan: 1, name: 'Block A', routines: [routine('r1', 'Push'), routine('r2', 'Pull')],
    week: { 1: ['r1'], 4: ['r2'] }, customEx: [],
    ...over,
  },
})

describe('draftFromProgram', () => {
  it('unpacks a bundle and deep-copies it, so editing cannot reach the loaded row', () => {
    const p = program()
    const d = draftFromProgram(p)
    expect(d.name).toBe('Block A')
    expect(d.routines.map(r => r.id)).toEqual(['r1', 'r2'])
    d.routines[0].name = 'Changed'
    d.week[1].push('r2')
    expect(p.bundle.routines[0].name).toBe('Push')
    expect(p.bundle.week[1]).toEqual(['r1'])
  })

  it('takes the library row name over the bundle name, the way the server resolves it', () => {
    const p = program({ name: 'stale name inside the bundle' })
    expect(draftFromProgram(p).name).toBe('Block A')
  })

  it('survives a bundle with nothing in it rather than throwing on the coach', () => {
    expect(draftFromProgram(null)).toMatchObject({ name: '', routines: [], week: {}, customEx: [] })
    expect(draftFromProgram({ name: 'X', bundle: { week: [1, 2] } })).toMatchObject({ week: {}, routines: [] })
  })

  it('carries targets and a check-in day through untouched', () => {
    // This editor never sets them — the send sheet asks per client — so the only thing it can do
    // with them is lose them. A rename that silently cleared a client's macros would not be
    // visible anywhere until the next send.
    const d = draftFromProgram(program({ nutrition: { kcal: 2400, p: 180 }, checkinDay: 0 }))
    expect(d.nutrition).toEqual({ kcal: 2400, p: 180 })
    expect(d.checkinDay).toBe(0)
    expect(bundleOf(d, []).nutrition).toEqual({ kcal: 2400, p: 180 })
    // 0 is Sunday: a truthy test here would make the one day the app defaults to the one day a
    // coach cannot deliberately keep.
    expect(bundleOf(d, []).checkinDay).toBe(0)
  })
})

describe('bundleOf', () => {
  it('includes the definition of a custom exercise the routines reference', () => {
    // Without this the client accepts a program containing an id that resolves to nothing, and the
    // exercise renders blank in their workout.
    const d = draftFromProgram(program({ routines: [routine('r1', 'Push', [{ id: 'cx1', sets: 3, reps: 8 }])] }))
    const b = bundleOf(d, [{ id: 'cx1', n: 'Landmine press', bp: 'chest' }, { id: 'cx2', n: 'Unused', bp: 'back' }])
    expect(b.customEx.map(c => c.id)).toEqual(['cx1'])
  })

  it('does not list the same custom exercise twice when the draft already carried it', () => {
    const d = draftFromProgram(program({
      routines: [routine('r1', 'Push', [{ id: 'cx1', sets: 3, reps: 8 }])],
      customEx: [{ id: 'cx1', n: 'Landmine press', bp: 'chest' }],
    }))
    const b = bundleOf(d, [{ id: 'cx1', n: 'Landmine press', bp: 'chest' }])
    expect(b.customEx).toHaveLength(1)
  })

  it('drops a weekday left pointing at a routine the program does not contain', () => {
    // Nothing in the editor can create one — removeRoutine cleans up after itself — but a program
    // saved by an older build can already carry one, and re-saving must not pass it on. To the
    // client a dangling day is a training day that opens nothing.
    const d = draftFromProgram(program({ routines: [routine('r1', 'Push')], week: { 1: ['r1'], 3: ['ghost'], 5: ['ghost', 'r1'] } }))
    const b = bundleOf(d, [])
    expect(b.week).toEqual({ 1: ['r1'], 5: ['r1'] })
  })

  it('names the bundle after the draft, which is what the client is offered', () => {
    const d = { ...draftFromProgram(program()), name: 'Block B' }
    expect(bundleOf(d, []).name).toBe('Block B')
  })
})

describe('editing', () => {
  it('changes one routine and leaves its siblings identical', () => {
    const d = draftFromProgram(program())
    const next = patchRoutine(d, 'r2', r => { r.name = 'Pull day' })
    expect(next.routines[1].name).toBe('Pull day')
    expect(next.routines[0]).toEqual(d.routines[0])
    expect(d.routines[1].name).toBe('Pull')      // the original is untouched
  })

  it('ignores a patch aimed at a routine that is no longer there', () => {
    const d = draftFromProgram(program())
    expect(patchRoutine(d, 'gone', r => { r.name = 'x' })).toEqual(d)
  })

  it('adds a routine and hands back the one it made, so the editor can navigate to it', () => {
    const { next, routine: added } = addRoutine(draftFromProgram(program()))
    expect(next.routines).toHaveLength(3)
    expect(added.name).toBe('Day 3')
    expect(next.routines[2].id).toBe(added.id)
    expect(added.ex).toEqual([])
  })

  it('pulls a removed routine off every weekday, and drops a day left with nothing', () => {
    // A day left as [] is a training day pointing at no session — the client sees a scheduled day
    // and opens nothing.
    const d = toggleDay(draftFromProgram(program()), 1, 'r2')   // Monday now holds r1 and r2
    expect(d.week[1]).toEqual(['r1', 'r2'])
    const next = removeRoutine(d, 'r1')
    expect(next.routines.map(r => r.id)).toEqual(['r2'])
    expect(next.week[1]).toEqual(['r2'])
    expect(next.week[4]).toEqual(['r2'])
    const last = removeRoutine({ ...next, routines: [...next.routines, routine('r3', 'Legs')] }, 'r2')
    expect(last.week).toEqual({})              // r2 was the only thing on both days
  })

  it('refuses to remove the last routine, because the server refuses to store the result', () => {
    const one = { ...draftFromProgram(program()), routines: [routine('r1', 'Push')] }
    expect(canRemoveRoutine(one)).toBe(false)
    expect(removeRoutine(one, 'r1')).toBe(one)
    expect(canRemoveRoutine(draftFromProgram(program()))).toBe(true)
  })
})

describe('the weekly schedule', () => {
  it('puts a routine on a day and takes it off again', () => {
    const d = draftFromProgram(program())
    expect(toggleDay(d, 3, 'r1').week[3]).toEqual(['r1'])
    expect(toggleDay(d, 1, 'r1').week[1]).toBeUndefined()   // was the only one on Monday
  })

  it('keeps several routines on one day in the order they were added', () => {
    let d = draftFromProgram(program())
    d = toggleDay(d, 1, 'r2')
    expect(d.week[1]).toEqual(['r1', 'r2'])
    d = toggleDay(d, 1, 'r1')
    expect(d.week[1]).toEqual(['r2'])
  })

  it('counts Sunday, which is day 0 and the easiest one to drop', () => {
    const d = toggleDay(draftFromProgram(program()), 0, 'r1')
    expect(scheduledDays(d)).toBe(3)
    expect(bundleOf(d, []).week[0]).toEqual(['r1'])
  })

  it('a new program starts with one routine and an empty week', () => {
    const d = newProgramDraft()
    expect(d.routines).toHaveLength(1)
    expect(d.routines[0].ex).toEqual([])
    expect(scheduledDays(d)).toBe(0)
    expect(canRemoveRoutine(d)).toBe(false)
  })
})
