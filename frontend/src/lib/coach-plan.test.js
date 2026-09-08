// What a member's plan must survive when a coach pushes a program to them.
//
// The whole promise of the accept flow is "nothing you already have is changed" — the sheet says
// so in every language. mergePlan is what has to keep that true, so these lock the promise rather
// than the implementation: existing routines, their ids, their exercises and the member's own
// weekly schedule all have to come out the other side untouched.
import { describe, it, expect } from 'vitest'
import { buildPlanBundle, buildProgramBundle, parsePlan, mergePlan } from './plan-share.js'

// A member with a plan of their own already in place.
const member = () => ({
  routines: [
    { id: 'own-1', name: 'My Legs', emoji: 'legs', ex: [{ id: '0043', sets: 5, reps: 5 }] },
    { id: 'own-2', name: 'My Arms', emoji: 'barbell', ex: [{ id: '0025', sets: 3, reps: 10 }] }
  ],
  week: { 1: 'own-1', 4: 'own-2' },
  customEx: []
})

// What a coach sends: built from their own state, exactly as the Coach screen does it.
const coachBundle = () => parsePlan(buildPlanBundle({
  routines: [{ id: 'coach-1', name: 'Block A — Push', emoji: 'barbell', ex: [{ id: '0025', sets: 4, reps: 8 }] }],
  week: { 2: 'coach-1' },
  customEx: []
}, 'Coach’s program'))

describe('accepting a coach’s program', () => {
  it('adds the coach’s routines without touching the member’s own', () => {
    const s = member()
    mergePlan(s, coachBundle(), { schedule: false })

    expect(s.routines).toHaveLength(3)
    // The member's two survive, by id, name and content — not merely by count.
    expect(s.routines.find(r => r.id === 'own-1')).toEqual(member().routines[0])
    expect(s.routines.find(r => r.id === 'own-2')).toEqual(member().routines[1])
    expect(s.routines.some(r => r.name === 'Block A — Push')).toBe(true)
  })

  it('gives the incoming routine a fresh id, so it can never overwrite one of theirs', () => {
    const s = member()
    // Force the collision the fresh-id rule exists to prevent.
    const bundle = coachBundle()
    bundle.routines[0].id = 'own-1'
    mergePlan(s, bundle, { schedule: false })

    expect(s.routines).toHaveLength(3)
    expect(s.routines.filter(r => r.id === 'own-1')).toHaveLength(1)
    expect(s.routines.find(r => r.id === 'own-1').name).toBe('My Legs')
  })

  it('leaves the member’s weekly schedule alone unless the coach asked to set it', () => {
    const s = member()
    mergePlan(s, coachBundle(), { schedule: false })
    expect(s.week).toEqual({ 1: 'own-1', 4: 'own-2' })
  })

  it('replaces the schedule only when the coach ticked that box, and points it at the new ids', () => {
    const s = member()
    mergePlan(s, coachBundle(), { schedule: true })

    // The coach's week wins wholesale — that is what the toggle promises.
    expect(Object.keys(s.week)).toEqual(['2'])
    // week[day] holds an array of routine ids since upstream's combine-routines change; a
    // coach's bundle still schedules one routine per day, so this reads the only entry.
    const scheduled = s.routines.find(r => r.id === s.week[2][0])
    expect(scheduled.name).toBe('Block A — Push')
    // Their routines are still there to re-schedule; only the assignments moved.
    expect(s.routines.filter(r => r.id.startsWith('own-'))).toHaveLength(2)
  })

  it('accepting twice duplicates rather than corrupting — the recovery path if a decide call fails', () => {
    const s = member()
    mergePlan(s, coachBundle(), { schedule: false })
    mergePlan(s, coachBundle(), { schedule: false })

    expect(s.routines).toHaveLength(4)
    expect(new Set(s.routines.map(r => r.id)).size).toBe(4)   // distinct, so both are deletable
    expect(s.routines.find(r => r.id === 'own-1').name).toBe('My Legs')
  })

  // The bug these exist for: the coach ticks "also set their weekly schedule" while their own
  // plan has no weekday assignments. buildPlanBundle then emits week:{}, PlanImport hides the
  // toggle because scheduledDays is 0, and the member is never shown the setting that is about
  // to erase their whole Mon-Sun plan. Clearing a week and putting nothing back is never what
  // anyone asked for, so mergePlan refuses it outright rather than trusting the caller.
  it('never clears the member’s week when the incoming plan has no scheduled days', () => {
    const s = member()
    const bundle = parsePlan(buildPlanBundle({
      routines: [{ id: 'c1', name: 'Block A', emoji: 'barbell', ex: [{ id: '0025', sets: 4, reps: 8 }] }],
      week: {}, customEx: []
    }, 'Coach plan'))
    expect(bundle.scheduledDays).toBe(0)

    mergePlan(s, bundle, { schedule: true })

    expect(s.week).toEqual({ 1: 'own-1', 4: 'own-2' })
    expect(s.routines).toHaveLength(3)          // the routines still arrive
  })

  it('never clears the week when the incoming days point at routines that aren’t in the plan', () => {
    // Same hole from the other side — a week entry referencing a routine the bundle doesn't
    // carry contributes nothing, so wiping first would again leave the member with an empty week.
    const s = member()
    const bundle = parsePlan({
      opengym_plan: 1, name: 'x', customEx: [],
      routines: [{ id: 'c1', name: 'Block A', ex: [{ id: '0025', sets: 3 }] }],
      week: { 2: 'a-routine-not-in-this-bundle' }
    })
    mergePlan(s, bundle, { schedule: true })

    expect(s.week).toEqual({ 1: 'own-1', 4: 'own-2' })
  })

  it('reuses a custom exercise the member already has instead of duplicating it', () => {
    const s = member()
    s.customEx = [{ id: 'mine', n: 'Sled Push', bp: 'legs' }]
    const bundle = parsePlan({
      opengym_plan: 1, name: 'x', week: {},
      routines: [{ id: 'c1', name: 'Conditioning', ex: [{ id: 'theirs', sets: 3 }] }],
      customEx: [{ id: 'theirs', n: 'sled push', bp: 'legs' }]   // same exercise, different id + case
    })
    mergePlan(s, bundle, { schedule: false })

    expect(s.customEx).toHaveLength(1)
    expect(s.routines.at(-1).ex[0].id).toBe('mine')
  })
})

/* ---------- the program library ---------- */
// A saved program is a frozen copy, not a view onto the coach's live plan. That is the whole
// point of having a library: progressing a client must not change what the coach trains
// tomorrow, and editing your own plan must not silently rewrite a program you saved last month.

describe('saving a program from selected routines', () => {
  const coachPlan = () => ({
    routines: [
      { id: 'a', name: 'Push', emoji: 'barbell', ex: [{ id: '0025', sets: 4, reps: 8 }] },
      { id: 'b', name: 'Pull', emoji: 'pullup', ex: [{ id: '0027', sets: 4, reps: 8 }] },
      { id: 'mine', name: 'My own cardio', emoji: 'bike', ex: [{ id: '0043', sets: 1, reps: 1 }] }
    ],
    week: { 1: 'a', 3: 'b', 5: 'mine' },
    customEx: []
  })
  // The real handler, not a re-implementation of it: Coach.jsx calls this same function, so
  // these tests fail if the shipped snapshot logic changes.
  const snapshot = buildProgramBundle

  it('takes only the routines that were picked, not the whole plan', () => {
    const bundle = snapshot(coachPlan(), ['a', 'b'], 'Block A')
    expect(bundle.routines.map(r => r.name)).toEqual(['Push', 'Pull'])
    expect(bundle.routines.some(r => r.name === 'My own cardio')).toBe(false)
  })

  it('drops weekdays pointing at routines that were left out', () => {
    // Otherwise the snapshot carries a schedule referencing routines it does not contain, and
    // mergePlan would clear the member's week and put only part of it back.
    const bundle = snapshot(coachPlan(), ['a', 'b'], 'Block A')
    expect(Object.keys(bundle.week).sort()).toEqual(['1', '3'])
  })

  it('is a copy — editing the coach’s plan afterwards leaves it untouched', () => {
    const S = coachPlan()
    const bundle = snapshot(S, ['a'], 'Block A')
    // The coach progresses their own training, hard.
    S.routines[0].name = 'Push (renamed)'
    S.routines[0].ex[0].sets = 99
    S.routines.push({ id: 'new', name: 'Added later', ex: [] })

    expect(bundle.routines).toHaveLength(1)
    expect(bundle.routines[0].name).toBe('Push')
    expect(bundle.routines[0].ex[0].sets).toBe(4)
  })

  it('what a member receives from a saved program still leaves their own plan alone', () => {
    const bundle = parsePlan(snapshot(coachPlan(), ['a', 'b'], 'Block A'))
    const s = member()
    mergePlan(s, bundle, { schedule: false })
    expect(s.routines.find(r => r.id === 'own-1').name).toBe('My Legs')
    expect(s.week).toEqual({ 1: 'own-1', 4: 'own-2' })
    expect(s.routines).toHaveLength(4)
  })
})
