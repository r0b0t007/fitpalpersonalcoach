import { describe, expect, it } from 'vitest'
import {
  ADHERENCE_ON_TRACK,
  ADHERENCE_SLIPPING,
  ADHERENCE_WINDOW_DAYS,
  adherenceBand,
  adherenceOf,
} from './adherence.js'

// A Wednesday, so weekday indices in `week` are unambiguous in the expectations below.
const TODAY = '2026-09-09'

// Monday(1)/Wednesday(3)/Friday(5) — the four fields the API sends per member.
const S = (over = {}) => ({
  routineIds: ['r1', 'r2'],
  week: { 1: ['r1'], 3: ['r2'], 5: ['r1'] },
  dayPlan: {},
  trainedDays: [],
  ...over,
})
const stateOn = (res, iso) => res.days.find(d => d.iso === iso).state

describe('adherence', () => {
  it('scores a planned day by whether anything was trained on it', () => {
    // Window is the 28 days ending today. Mon 7th planned + trained, Mon 31 Aug planned + missed.
    const r = adherenceOf(S({ trainedDays: ['2026-09-07'] }), TODAY)
    expect(stateOn(r, '2026-09-07')).toBe('trained')
    expect(stateOn(r, '2026-08-31')).toBe('missed')
    expect(stateOn(r, '2026-09-08')).toBe('rest')     // a Tuesday, never planned
    expect(r.trained).toBe(1)
    expect(r.missed).toBe(r.planned - 1)
  })

  it('counts a combined day once, so reorganising a split does not move the denominator', () => {
    const split = adherenceOf(S(), TODAY).planned
    const combined = adherenceOf(S({ week: { 1: ['r1', 'r2'], 3: ['r2'], 5: ['r1'] } }), TODAY).planned
    expect(combined).toBe(split)
  })

  it('leaves today out of the ratio entirely', () => {
    // Today is a planned Wednesday. Scored, it would be a miss and drag the rate down every
    // morning; the day is not over, so it belongs on neither side.
    const r = adherenceOf(S(), TODAY)
    expect(stateOn(r, TODAY)).toBe('pending')
    expect(r.pending).toBe(true)
    expect(r.days.filter(d => d.state === 'pending')).toHaveLength(1)

    // The same window plus one day, so today's untrained Wednesday is now in the past: it
    // should appear on both sides exactly once, which is what "excluded until it is over" means.
    const tomorrow = adherenceOf(S(), '2026-09-10', ADHERENCE_WINDOW_DAYS + 1)
    expect(tomorrow.days[0].iso).toBe(r.days[0].iso)
    expect(tomorrow.planned).toBe(r.planned + 1)
    expect(tomorrow.missed).toBe(r.missed + 1)
  })

  it('still shows a session logged today as trained', () => {
    // Excluded from the ratio, but the strip must not contradict the workout just finished.
    const r = adherenceOf(S({ trainedDays: [TODAY] }), TODAY)
    expect(stateOn(r, TODAY)).toBe('trained')
    expect(r.trained).toBe(0)   // not scored
    expect(r.extra).toBe(0)
  })

  it('reports an unplanned session as extra and never lets it inflate the rate', () => {
    const r = adherenceOf(S({ trainedDays: ['2026-09-08', '2026-09-07'] }), TODAY)
    expect(stateOn(r, '2026-09-08')).toBe('extra')
    expect(r.extra).toBe(1)
    expect(r.rate).toBeLessThanOrEqual(1)
    expect(r.trained).toBe(1)
  })

  it('honours a per-date override in both directions', () => {
    const rest = adherenceOf(S({ dayPlan: { '2026-09-07': 'rest' } }), TODAY)
    expect(stateOn(rest, '2026-09-07')).toBe('rest')

    const moved = adherenceOf(S({ dayPlan: { '2026-09-08': 'r1' }, trainedDays: ['2026-09-08'] }), TODAY)
    expect(stateOn(moved, '2026-09-08')).toBe('trained')
    expect(moved.extra).toBe(0)   // rescheduled, not extra
  })

  it('ignores a weekday pointing at a routine that no longer exists', () => {
    // Deleting a routine leaves the id in `week`; effectiveRoutineIds filters it, and a day
    // that cannot be trained must not be scored as missed.
    const r = adherenceOf(S({ week: { 1: ['gone'], 3: ['r2'], 5: ['r1'] } }), TODAY)
    expect(stateOn(r, '2026-09-07')).toBe('rest')
  })

  it('returns a null rate rather than 0 when nothing is planned', () => {
    const r = adherenceOf(S({ week: {} }), TODAY)
    expect(r.planned).toBe(0)
    expect(r.rate).toBeNull()      // no plan is not 0% adherence
    expect(r.missed).toBe(0)
  })

  it('reports a full window of the requested length, oldest first', () => {
    const r = adherenceOf(S(), TODAY)
    expect(r.days).toHaveLength(ADHERENCE_WINDOW_DAYS)
    expect(r.days[0].iso).toBe('2026-08-13')
    expect(r.days[r.days.length - 1].iso).toBe(TODAY)
    const short = adherenceOf(S(), TODAY, 7)
    expect(short.days).toHaveLength(7)
    expect(short.days[0].iso).toBe('2026-09-03')
  })

  it('survives a state that has never been trained on or planned', () => {
    const r = adherenceOf({}, TODAY)
    expect(r.rate).toBeNull()
    expect(r.days).toHaveLength(ADHERENCE_WINDOW_DAYS)
  })

  it('crosses a month boundary without losing or repeating a day', () => {
    const r = adherenceOf(S(), '2026-03-02', 5)
    expect(r.days.map(d => d.iso)).toEqual(
      ['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  })
})

describe('adherenceOf — trimming the payload', () => {
  const parts = S

  it('is unchanged by data older than the window — the property the server trims on', () => {
    // The server drops pre-window dayPlan entries and workout dates so a roster payload cannot
    // grow without bound. That is only sound if they cannot move the number.
    const lean = adherenceOf(parts({ trainedDays: ['2026-09-07'] }), TODAY)
    const fat = adherenceOf(parts({
      trainedDays: ['2026-09-07', '2024-01-02', '2019-06-30'],
      dayPlan: { '2024-01-02': 'rest', '2019-06-30': 'r1' },
    }), TODAY)
    expect(fat).toEqual(lean)
  })

  it('treats every missing field as empty rather than throwing', () => {
    // A member card for someone who has opened the app once and done nothing.
    expect(adherenceOf({}, TODAY).rate).toBeNull()
    expect(adherenceOf(undefined, TODAY).days).toHaveLength(ADHERENCE_WINDOW_DAYS)
  })
})

describe('adherenceBand', () => {
  it('splits into three, inclusive at each threshold', () => {
    expect(adherenceBand(1)).toBe('on-track')
    expect(adherenceBand(ADHERENCE_ON_TRACK)).toBe('on-track')
    expect(adherenceBand(ADHERENCE_ON_TRACK - 0.001)).toBe('slipping')
    expect(adherenceBand(ADHERENCE_SLIPPING)).toBe('slipping')
    expect(adherenceBand(ADHERENCE_SLIPPING - 0.001)).toBe('off-track')
    expect(adherenceBand(0)).toBe('off-track')
  })

  it('has no band for a member with no plan, rather than the worst one', () => {
    expect(adherenceBand(null)).toBeNull()
    expect(adherenceBand(adherenceOf(S({ week: {} }), TODAY).rate)).toBeNull()
  })
})
