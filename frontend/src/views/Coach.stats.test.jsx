// @vitest-environment happy-dom
//
// The coach's member view renders the member's own Stats panels. Two shape differences between
// GET /api/coach/member and the client's own store would produce a plausible-looking but wrong
// chart rather than an error, so they are pinned here:
//
//   · the API returns workouts newest-first; S.workouts is oldest-first everywhere else
//   · the API strips routines to { id, name, count } with no `ex`
//
// Both are silent failures — a reversed body-weight curve reads as a client losing weight when
// they are gaining — which is exactly the kind of thing a coach would act on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {},
  syncReminder: () => {}, initReminderSync: () => {}, writeAutoBackup: () => {},
}))

const { DEF } = await import('../store/useStore.js')
const { StatsPanels } = await import('./Stats.jsx')

// Mirrors memberState() in Coach.jsx. Kept as a local copy on purpose: the point of the test is
// that the transform exists and stays correct, so importing the implementation would test nothing.
const memberState = d => ({
  ...DEF,
  unit: d.unit, body: d.body, targetW: d.targetW, effort: d.effort, showRir: d.showRir,
  bodyweight: d.bodyweight || [],
  workouts: [...(d.workouts || [])].reverse(),
  routines: []
})

const payload = {
  user: { id: 'm1', name: 'Sam', created: '2026-01-01' },
  unit: 'lb', lastSync: 123, body: 'female', targetW: 70, effort: 'rir', showRir: null,
  bodyweight: [{ d: '2026-09-01', w: 80 }],
  // newest-first, as the route returns it. Shaped like a real logged session: the panels walk
  // w.entries[].sets[], so a stub of { id, d } would pass this test while telling us nothing.
  workouts: [3, 2, 1].map(n => ({
    id: 'w' + n, d: '2026-09-0' + n, name: 'Push',
    start: Date.parse('2026-09-0' + n + 'T10:00:00Z'),
    end: Date.parse('2026-09-0' + n + 'T11:00:00Z'),
    vol: 4200,
    entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }]
  })),
  routines: [{ id: 'r1', name: 'Push', emoji: 'barbell', count: 5 }]
}

describe('coach member state', () => {
  it('puts workouts back in oldest-first order for the panels', () => {
    expect(memberState(payload).workouts.map(w => w.id)).toEqual(['w1', 'w2', 'w3'])
  })

  it('carries the display fields the panels read', () => {
    const S = memberState(payload)
    expect(S.unit).toBe('lb')
    expect(S.body).toBe('female')
    expect(S.targetW).toBe(70)
    expect(S.effort).toBe('rir')
    expect(S.bodyweight).toHaveLength(1)
  })

  it('withholds the stripped routines rather than passing ones with no exercises', () => {
    // r.ex is absent in the coach payload; anything reading it would see undefined, not a routine.
    expect(memberState(payload).routines).toEqual([])
  })

  it('fills every other field from DEF, so a panel reading one does not throw', () => {
    const S = memberState(payload)
    for (const k of Object.keys(DEF)) expect(S).toHaveProperty(k)
  })

  it('survives a member with no training at all', () => {
    const S = memberState({ unit: 'kg', body: 'male', targetW: null, effort: null, showRir: null })
    expect(S.workouts).toEqual([])
    expect(S.bodyweight).toEqual([])
  })
})

// The transform being right is only half of it: the panels have to actually render against a
// member's state without reaching for something the coach payload does not carry.
describe('StatsPanels against a member payload', () => {
  const render = S => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      createRoot(host).render(
        <MemoryRouter><StatsPanels S={S} readOnly /></MemoryRouter>
      )
    })
    return host
  }

  it('renders a member with training without throwing', () => {
    const host = render(memberState(payload))
    expect(host.textContent).toBeTruthy()
  })

  it('renders a member with no training at all', () => {
    const host = render(memberState({ unit: 'kg', body: 'male', targetW: null, effort: null, showRir: null }))
    expect(host.textContent).toBeTruthy()
  })

  it("hides the controls that would write to the coach's own data", () => {
    const text = render(memberState(payload)).textContent
    // "Goal" and "Log" open sheets bound to the viewer's store, not the member's.
    expect(text).not.toContain('Goal')
    expect(text).not.toContain('Log')
  })
})

// Adherence is scored from two differently-shaped payloads — the roster's four trimmed fields
// and the opened member's full plan + history — and the two are easy to confuse, because a
// scored result and the parts it was scored from are both plausible-looking objects. Reading
// `.rate` off the parts yields undefined and renders nothing at all: no error, just a column
// that quietly stops appearing. That is what these pin.
const { AdherenceCard, RosterAdherence, memberAdherence } = await import('./Coach.jsx')

describe('adherence in the coach view', () => {
  // Fixed, never the clock. memberAdherence defaults `todayIso` to today, so a test that let it
  // do that would pass now and start failing the day 2026-09-07 fell out of the 28-day window --
  // unattended, in CI, weeks after the change that "caused" it.
  const TODAY = '2026-09-09'
  // A Wednesday. Monday/Wednesday/Friday plan, trained the Monday just gone.
  const parts = (over = {}) => ({
    week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] },
    dayPlan: {},
    routineIds: ['r1'],
    trainedDays: ['2026-09-07'],
    ...over,
  })
  const render = el => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => { createRoot(host).render(el) })
    return host
  }

  it('renders a percentage from the roster wire shape, not from a scored result', () => {
    const text = render(<RosterAdherence parts={parts()} />).textContent
    expect(text).toMatch(/%/)
    expect(text).toMatch(/28d/)
  })

  it('renders nothing in the roster for a member with no training week', () => {
    expect(render(<RosterAdherence parts={parts({ week: {} })} />).textContent).toBe('')
    expect(render(<RosterAdherence parts={undefined} />).textContent).toBe('')
  })

  it('says there is nothing to miss rather than 0% when no week is set', () => {
    const text = render(<AdherenceCard a={memberAdherence({ week: {}, dayPlan: {}, routines: [], workouts: [] }, TODAY)} />).textContent
    expect(text).toContain('nothing to miss')
    expect(text).not.toContain('0%')
  })

  it('builds the same score from the opened member payload as from the roster fields', () => {
    // The detail route sends routines as objects and workouts as whole sessions; the roster
    // sends ids and dates. Same person, same number.
    const detail = memberAdherence({
      week: parts().week, dayPlan: {},
      routines: [{ id: 'r1', name: 'Push', count: 5 }],
      workouts: [{ id: 'w1', d: '2026-09-07', entries: [] }],
    }, TODAY)
    expect(detail.planned).toBeGreaterThan(0)
    expect(detail.trained).toBe(1)
  })

  it('drops a routine with no exercises rather than scoring days nobody could train', () => {
    // `count` is the exercise count in the detail payload. A skeleton routine assigned to the
    // week is refused by the start button, so its days are not sessions anyone missed.
    const skeleton = memberAdherence({
      week: parts().week, dayPlan: {}, routines: [{ id: 'r1', count: 0 }], workouts: [],
    }, TODAY)
    expect(skeleton.planned).toBe(0)
    expect(skeleton.rate).toBeNull()
  })

  it('draws one cell per day in the window', () => {
    const host = render(<AdherenceCard a={memberAdherence({
      week: parts().week, dayPlan: {}, routines: [{ id: 'r1', count: 3 }],
      workouts: [{ d: '2026-09-07' }],
    }, TODAY)} />)
    // The strip is the last flex row in the card.
    const strip = [...host.querySelectorAll('div')].find(d => d.style.display === 'flex' && d.children.length > 7)
    expect(strip.children).toHaveLength(28)
  })

  it('starts the strip at the join date for a member added mid-window', () => {
    const host = render(<AdherenceCard a={memberAdherence({
      week: parts().week, dayPlan: {}, routines: [{ id: 'r1', count: 3 }],
      workouts: [{ d: '2026-09-07' }],
      user: { created: '2026-09-07T08:00:00.000Z' },
    }, TODAY)} />)
    const strip = [...host.querySelectorAll('div')].find(d => d.style.display === 'flex' && d.children.length > 1)
    expect(strip.children).toHaveLength(3)   // 7th, 8th, 9th
  })
})
