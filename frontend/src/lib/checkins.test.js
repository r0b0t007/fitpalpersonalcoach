import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHECKIN_DAY,
  NOTE_MAX,
  QUESTIONS,
  checkinDayOf,
  checkinStreak,
  currentCheckin,
  isCheckinDue,
  isValidAnswer,
  periodStart,
  removeCheckin,
  scoreOf,
  seriesFor,
  upsertCheckin,
} from './checkins.js'

// 2026-09-09 is a Wednesday; 2026-09-06 the Sunday before it.
const WED = '2026-09-09'
const SUN = '2026-09-06'
const S = (over = {}) => ({ checkins: [], ...over })
const filed = (d, answers = { energy: 4 }, note) => ({ d, answers, note, t: Date.parse(d) })

describe('the scales', () => {
  it('all point the same way, so a row of 5s is unambiguously a good week', () => {
    // Soreness and stress are phrased as their positive pole (Recovery, Life stress = calm) for
    // exactly this reason: mixed directions read fine to whoever wrote the form and produce
    // garbage from everyone else.
    expect(QUESTIONS.map(q => q.id)).toEqual(['energy', 'sleep', 'recovery', 'stress', 'nutrition'])
    for (const q of QUESTIONS) expect(q.label).toBeTruthy()
  })

  it('accepts only whole numbers in range', () => {
    expect(isValidAnswer(1)).toBe(true)
    expect(isValidAnswer(5)).toBe(true)
    expect(isValidAnswer(0)).toBe(false)
    expect(isValidAnswer(6)).toBe(false)
    expect(isValidAnswer(3.5)).toBe(false)
    expect(isValidAnswer('4')).toBe(false)
    expect(isValidAnswer(undefined)).toBe(false)
  })
})

describe('the period a check-in belongs to', () => {
  it('runs from the most recent check-in day, inclusive', () => {
    expect(periodStart(S(), WED)).toBe(SUN)
    expect(periodStart(S(), SUN)).toBe(SUN)          // on the day itself
    expect(periodStart(S(), '2026-09-05')).toBe('2026-08-30')
  })

  it('honours a coach-set day and falls back for a bad one', () => {
    expect(checkinDayOf({ checkinDay: 3 })).toBe(3)
    expect(periodStart({ checkinDay: 3 }, WED)).toBe(WED)   // Wednesday is the day
    expect(checkinDayOf({ checkinDay: 9 })).toBe(DEFAULT_CHECKIN_DAY)
    expect(checkinDayOf({ checkinDay: 'sun' })).toBe(DEFAULT_CHECKIN_DAY)
    expect(checkinDayOf({})).toBe(DEFAULT_CHECKIN_DAY)
  })
})

describe('whether one is owed', () => {
  it('is due from the check-in day until it is filed', () => {
    expect(isCheckinDue(S(), SUN)).toBe(true)
    expect(isCheckinDue(S(), WED)).toBe(true)
    expect(isCheckinDue(S({ checkins: [filed(SUN)] }), WED)).toBe(false)
  })

  it('does not nag again in the same week for a check-in filed late', () => {
    // Filed on the Tuesday for the period that opened on Sunday.
    expect(isCheckinDue(S({ checkins: [filed('2026-09-08')] }), WED)).toBe(false)
  })

  it('comes due again in the next period', () => {
    const s = S({ checkins: [filed('2026-08-30')] })
    expect(isCheckinDue(s, '2026-09-05')).toBe(false)  // still that period
    expect(isCheckinDue(s, SUN)).toBe(true)            // new period opened
  })

  it('does not drift when someone is late', () => {
    // "More than 7 days since the last one" would move the due date to the Tuesday forever.
    // Anchoring to the weekday keeps the reminder where the coach put it.
    const late = S({ checkins: [filed('2026-09-08')] })
    expect(periodStart(late, '2026-09-13')).toBe('2026-09-13')
    expect(isCheckinDue(late, '2026-09-13')).toBe(true)
  })

  it('returns the current one, or null', () => {
    expect(currentCheckin(S({ checkins: [filed(SUN)] }), WED).d).toBe(SUN)
    expect(currentCheckin(S({ checkins: [filed('2026-08-30')] }), WED)).toBeNull()
    expect(currentCheckin(S(), WED)).toBeNull()
  })
})

describe('filing one', () => {
  it('keeps only valid answers, sparsely', () => {
    // Absent, not 0: "did not answer" and "answered badly" must never collapse into one number.
    const l = upsertCheckin([], { d: SUN, answers: { energy: 4, sleep: 0, recovery: 9, stress: 3 } })
    expect(l[0].answers).toEqual({ energy: 4, stress: 3 })
    expect('sleep' in l[0].answers).toBe(false)
  })

  it('replaces the same date rather than stacking', () => {
    let l = upsertCheckin([], { d: SUN, answers: { energy: 2 } })
    l = upsertCheckin(l, { d: SUN, answers: { energy: 5 } })
    expect(l).toHaveLength(1)
    expect(l[0].answers.energy).toBe(5)
  })

  it('keeps the list sorted however it arrives', () => {
    let l = upsertCheckin([], { d: '2026-09-06', answers: { energy: 4 } })
    l = upsertCheckin(l, { d: '2026-08-23', answers: { energy: 3 } })
    l = upsertCheckin(l, { d: '2026-08-30', answers: { energy: 5 } })
    expect(l.map(c => c.d)).toEqual(['2026-08-23', '2026-08-30', '2026-09-06'])
  })

  it('trims a note, drops an empty one, and caps a long one', () => {
    expect(upsertCheckin([], { d: SUN, note: '  knee is fine now  ' })[0].note).toBe('knee is fine now')
    expect('note' in upsertCheckin([], { d: SUN, note: '   ' })[0]).toBe(false)
    expect(upsertCheckin([], { d: SUN, note: 'x'.repeat(NOTE_MAX + 50) })[0].note).toHaveLength(NOTE_MAX)
  })

  it('does not mutate the array it was given', () => {
    const before = [filed(SUN)]
    upsertCheckin(before, { d: '2026-09-13', answers: { energy: 3 } })
    expect(before).toHaveLength(1)
  })

  it('removes one date and leaves the rest', () => {
    const l = [filed('2026-08-30'), filed(SUN)]
    expect(removeCheckin(l, SUN).map(c => c.d)).toEqual(['2026-08-30'])
    expect(removeCheckin(undefined, SUN)).toEqual([])
  })
})

describe('reading it back', () => {
  it('scores the mean of what was answered', () => {
    expect(scoreOf({ answers: { energy: 4, sleep: 5, recovery: 3 } })).toBe(4)
    expect(scoreOf({ answers: { energy: 4, sleep: 5 } })).toBe(4.5)
  })

  it('scores an empty form as null, not zero', () => {
    // 0 would render as the worst week possible for someone who simply skipped the scales.
    expect(scoreOf({ answers: {} })).toBeNull()
    expect(scoreOf({})).toBeNull()
    expect(scoreOf(undefined)).toBeNull()
  })

  it('emits LineChart points for one question, oldest first', () => {
    const s = S({ checkins: [filed('2026-09-06', { sleep: 2 }), filed('2026-08-30', { sleep: 4 })] })
    const pts = seriesFor(s, 'sleep')
    expect(pts.map(p => p.y)).toEqual([4, 2])
    expect(Object.keys(pts[0]).sort()).toEqual(['d', 't', 'y'])
  })

  it('leaves unanswered weeks out of a series rather than plotting a gap as zero', () => {
    const s = S({ checkins: [filed('2026-08-30', { sleep: 4 }), filed('2026-09-06', { energy: 3 })] })
    expect(seriesFor(s, 'sleep')).toHaveLength(1)
  })
})

describe('the streak', () => {
  const weeks = (...isos) => S({ checkins: isos.map(d => filed(d)) })

  it('counts consecutive filed periods', () => {
    expect(checkinStreak(weeks('2026-08-23', '2026-08-30', SUN), WED)).toBe(3)
  })

  it('does not break on the current week merely being unfiled', () => {
    // Mid-week, before answering: the week is open, not missed. Otherwise every client's streak
    // reads 0 for the six days between the check-in day and their filling it in.
    expect(checkinStreak(weeks('2026-08-23', '2026-08-30'), WED)).toBe(2)
  })

  it('breaks on a genuinely missed period', () => {
    expect(checkinStreak(weeks('2026-08-16', '2026-08-30', SUN), WED)).toBe(2)
  })

  it('is 0 for someone who has never checked in', () => {
    expect(checkinStreak(S(), WED)).toBe(0)
  })

  it('counts a check-in filed on any day of its period', () => {
    // Filed Tuesday for the Sunday period, plus the week before.
    expect(checkinStreak(weeks('2026-08-30', '2026-09-08'), WED)).toBe(2)
  })
})
