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
import { todayISO } from '../../lib/format.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {},
  syncReminder: () => {}, initReminderSync: () => {}, writeAutoBackup: () => {},
}))

const { DEF } = await import('../../store/useStore.js')
const { StatsPanels } = await import('../Stats.jsx')

// Mirrors memberState() in views/coach/parts.jsx. Kept as a local copy on purpose: the point of
// the test is that the transform exists and stays correct, so importing the implementation would
// test nothing.
//
// THE COPY IS THE HAZARD, THOUGH, AND IT HAS ALREADY BITTEN. It silently fell five fields behind
// the real one — checkins, checkinDay, meals, mealDays, nutriTarget — and a test written against
// it then failed for the mirror's reasons rather than the code's. Of those five, the three that
// matter here are the nutrition ones: StatsPanels reads them, so a mirror without them renders a
// client who looks like they never ate. `checkins`/`checkinDay` have no consumer on this path at
// all — Stats.jsx never reads them, and views/coach/ClientDetail.jsx hands them straight to
// this transform — so they are carried for fidelity with the real thing, nothing more.
//
// The parity test below is what actually enforces this. A comment cannot fail CI, and this drift
// already survived two whole features.
const memberState = d => ({
  ...DEF,
  unit: d.unit, body: d.body, targetW: d.targetW, effort: d.effort, showRir: d.showRir,
  bodyweight: d.bodyweight || [],
  measurements: d.measurements || [],
  checkins: d.checkins || [],
  checkinDay: d.checkinDay ?? null,
  meals: d.meals || [],
  mealDays: d.mealDays || {},
  nutriTarget: d.nutriTarget ?? null,
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
  routines: [{ id: 'r1', name: 'Push', emoji: 'barbell', count: 5 }],
  measurements: [
    { d: '2026-07-01', site: 'waist', v: 88, t: Date.parse('2026-07-01') },
    { d: '2026-09-01', site: 'waist', v: 84, t: Date.parse('2026-09-01') },
  ]
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
const { AdherenceCard, CheckinsCard, RosterAdherence, memberAdherence, memberState: realMemberState } = await import('./parts.jsx')

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
    const text = render(<RosterAdherence parts={parts()} todayIso={TODAY} />).textContent
    expect(text).toMatch(/%/)
    expect(text).toMatch(/28d/)
  })

  it('renders nothing in the roster for a member with no training week', () => {
    expect(render(<RosterAdherence parts={parts({ week: {} })} todayIso={TODAY} />).textContent).toBe('')
    expect(render(<RosterAdherence parts={undefined} todayIso={TODAY} />).textContent).toBe('')
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

describe('a short window says so', () => {
  const render = el => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => { createRoot(host).render(el) })
    return host
  }
  const joinedRecently = {
    week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] }, dayPlan: {},
    routines: [{ id: 'r1', count: 3 }],
    workouts: [{ d: '2026-09-07' }],
    user: { created: '2026-09-07T08:00:00.000Z' },
  }

  it('captions the roster with the days actually scored, not the window constant', () => {
    // "28d" over a three-day score sells one Monday as a month of turning up.
    const parts = {
      week: joinedRecently.week, dayPlan: {}, routineIds: ['r1'],
      trainedDays: ['2026-09-07'], created: '2026-09-07T08:00:00.000Z',
    }
    expect(render(<RosterAdherence parts={parts} todayIso="2026-09-09" />).textContent).toContain('3d')
  })

  it('heads the card with the days actually scored', () => {
    const text = render(<AdherenceCard a={memberAdherence(joinedRecently, '2026-09-09')} />).textContent
    expect(text).toContain('last 3 days')
    expect(text).not.toContain('last 28 days')
  })

  it('does not stretch a three-day strip to the width of a month', () => {
    const host = render(<AdherenceCard a={memberAdherence(joinedRecently, '2026-09-09')} />)
    const strip = [...host.querySelectorAll('div')].find(d => d.style.display === 'flex' && d.children.length > 1)
    expect(strip.children).toHaveLength(3)
    expect(strip.children[0].style.maxWidth).toBe('14px')
  })
})

// The tape rides the same prop-driven panel as everything else, which is the whole reason it
// cost one field on the wire. That only holds while the transform actually carries it — and a
// missing array renders as "nothing logged yet" rather than as an error, so it would look like
// a client who has never measured instead of a bug.
describe('measurements in the coach view', () => {
  const render = S => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      createRoot(host).render(<MemoryRouter><StatsPanels S={S} readOnly /></MemoryRouter>)
    })
    return host
  }

  it('carries the measurements through to the panels', () => {
    expect(memberState(payload).measurements).toHaveLength(2)
    const text = render(memberState(payload)).textContent
    expect(text).toContain('Waist')
    expect(text).toContain('84')
  })

  it('shows the 90-day move rather than only the latest number', () => {
    // 88 -> 84 is the reading a coach acts on; the current value alone hides it.
    const text = render(memberState(payload)).textContent
    expect(text).toMatch(/-4/)
  })

  it('offers no way to log from the coach view', () => {
    // The sheet writes to the *viewer's* store, so a coach pressing Log would measure themselves.
    const host = render(memberState(payload))
    const logs = [...host.querySelectorAll('button')].filter(b => /^Log$/.test(b.textContent.trim()))
    expect(logs).toHaveLength(0)
  })

  it('says nothing is logged for a member who has never measured', () => {
    const text = render(memberState({ ...payload, measurements: [] })).textContent
    expect(text).toContain('No measurements logged yet.')
  })
})

// The note is the point of a check-in; the scales are context for it. A coach reads this to find
// out what the training data cannot tell them, so the note must survive the trip intact and an
// unanswered form must not masquerade as a terrible week.
describe('check-ins in the coach view', () => {
  const render = el => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => { createRoot(host).render(el) })
    return host
  }

  it('shows the note, the answered scales and the mean', () => {
    const text = render(<CheckinsCard checkins={[
      { d: '2026-09-06', answers: { energy: 4, sleep: 2 }, note: 'Knee grumbling on squats.', t: 1 },
    ]} />).textContent
    expect(text).toContain('Knee grumbling on squats.')
    expect(text).toContain('Energy')
    expect(text).toContain('3')          // mean of 4 and 2
  })

  it('shows no score at all for a form with no scales answered', () => {
    // A zero here would read as the worst week possible from someone who only left a note.
    const text = render(<CheckinsCard checkins={[
      { d: '2026-09-06', answers: {}, note: 'Away all week.', t: 1 },
    ]} />).textContent
    expect(text).toContain('Away all week.')
    expect(text).not.toContain('/5')
  })

  it('lists newest first', () => {
    const text = render(<CheckinsCard checkins={[
      { d: '2026-08-30', answers: { energy: 1 }, note: 'older', t: 1 },
      { d: '2026-09-06', answers: { energy: 5 }, note: 'newer', t: 2 },
    ]} />).textContent
    expect(text.indexOf('newer')).toBeLessThan(text.indexOf('older'))
  })

  it('says none are filed rather than rendering an empty card', () => {
    expect(render(<CheckinsCard checkins={[]} />).textContent).toContain('None filed yet.')
    expect(render(<CheckinsCard checkins={undefined} />).textContent).toContain('None filed yet.')
  })
})

// The third of step 8's scope is "let the coach see it", and it is the third with no test. The
// server sends meals/mealDays/nutriTarget and coach-smoke asserts they are on the wire; nothing
// asserted the coach VIEW draws them. That gap matters more here than elsewhere, because the card
// is gated on hasNutrition(S): drop the field on the wire or in memberState and the card simply
// does not render. No error, no empty state — it looks exactly like a client who never logged a
// meal. Same silent shape the measurements tests were written for.
describe('nutrition in the coach view', () => {
  const render = S => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      createRoot(host).render(<MemoryRouter><StatsPanels S={S} readOnly /></MemoryRouter>)
    })
    return host
  }
  // todayISO(), NOT toISOString().slice(0,10). NutritionCard asks todayISO() what day it is, and
  // that is the LOCAL day; toISOString gives the UTC one. They agree on a UTC runner and diverge
  // for anyone east or west of it for part of every day — so a UTC-dated fixture silently lands
  // on "yesterday", totalsFor finds nothing, and the card renders the very string this suite
  // exists to catch: "0 / 2,200 kcal". The first version of this file made exactly that mistake,
  // hours after the same bug was fixed in coach-local.test.js. Third time in this repo.
  const today = todayISO()
  const fed = {
    ...payload,
    meals: [
      { id: 'm1', d: today, n: 'Oats', g: 80, kcal: 304, p: 10.4, c: 48, f: 5.6, t: 1 },
      { id: 'm2', d: today, n: 'Chicken', g: 200, kcal: 330, p: 62, c: 0, f: 7.2, t: 2 },
    ],
    mealDays: {},
    nutriTarget: { kcal: 2200, p: 160, c: 220, f: 70 },
  }

  // '634 / 2,200' and not /634/: the average line below the chart ("634 kcal on average") carries
  // the same number and does NOT depend on the entry falling on today, so a loose match stays
  // green even when the day is wrong — which is precisely how the UTC bug above hid itself.
  it("shows today's intake against the target the coach set", () => {
    const text = render(memberState(fed)).textContent
    expect(text).toContain('Nutrition')
    expect(text).toContain('634 / 2,200')
    expect(text).toContain('72.4 / 160')        // protein too, so one number cannot carry the test
  })

  it('offers no way to log from the coach view', () => {
    // Log navigates to /nutrition — the VIEWER's own screen. A coach pressing it would be sent
    // off to log their own breakfast from inside their client's progress.
    const host = render(memberState(fed))
    const logs = [...host.querySelectorAll('button')].filter(b => /^Log$/.test(b.textContent.trim()))
    expect(logs).toHaveLength(0)
  })

  // mealDays is not a minor field: past MEALS_KEEP_DAYS, compactMeals has rolled a client's
  // history into it and it is ALL the coach's chart has left. Both fixtures above set it to {},
  // and DEF supplies {} too, so dropping it from the transform was invisible — verified by
  // deleting the mirror line and watching every test stay green.
  it('draws a card at all for a history that has already been compacted', () => {
    // Note what is NOT asserted: the rolled-up figure itself. compactMeals only rolls days past
    // MEALS_KEEP_DAYS (120), so a compacted day is by definition older than the chart's default
    // 30-day window and correctly renders "Nothing logged in this window" — reading 2,100 here
    // would need the All range, which is a different test. The property that matters on the wire
    // is that the rollup ALONE satisfies hasNutrition, so a client whose history has aged out
    // still gets a card instead of vanishing from the coach's view entirely.
    const rolled = { ...payload, meals: [], nutriTarget: null, mealDays: { '2026-01-04': [2100, 150, 210, 65] } }
    expect(render(memberState(rolled)).textContent).toContain('Nutrition')
  })

  it('draws nothing at all for a member who has never logged a meal', () => {
    // The honest empty state here is absence: a zero-calorie day is not the same as no data, and
    // rendering "0 kcal" against a coach's target would read as a client who ate nothing.
    const text = render(memberState({ ...payload, meals: [], mealDays: {}, nutriTarget: null })).textContent
    expect(text).not.toContain('Nutrition')
  })
})

// The mirror above is only worth keeping if it cannot drift, and it already did — five fields,
// across two features, with nothing going red. This is the guard: the real transform is imported
// for its SHAPE only, so the behavioural assertions still run against the local copy and still
// test the transform rather than importing it, but a field added on one side alone fails here.
describe('the local memberState mirror matches the real one', () => {
  it('carries exactly the same keys', () => {
    const full = {
      ...payload,
      checkins: [{ d: '2026-09-06', answers: { energy: 4 }, t: 1 }], checkinDay: 3,
      meals: [{ id: 'm1', d: '2026-09-06', n: 'Oats', g: 80, kcal: 304, p: 10, c: 48, f: 6, t: 1 }],
      mealDays: { '2026-01-04': [2100, 150, 210, 65] },
      nutriTarget: { kcal: 2200 },
    }
    expect(Object.keys(memberState(full)).sort()).toEqual(Object.keys(realMemberState(full)).sort())
  })
})
