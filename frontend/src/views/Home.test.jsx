// @vitest-environment happy-dom
//
// Home now adapts to whether somebody has a coach, and the three states are easy to confuse in
// code because they differ by two falsy checks. Getting it wrong is not cosmetic: offering "Load
// starter plan" to a client whose coach is mid-way through writing their program invites them to
// build something that is about to be replaced, and hiding that button from somebody training
// alone leaves them on an empty app with no way in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let PHOTOS = []
let photosFail = false
vi.mock('../lib/api.js', async importOriginal => ({
  ...await importOriginal(),
  api: async () => ({}),
  fetchMyPhotos: async () => { if (photosFail) throw new Error('offline'); return PHOTOS },
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { default: Home } = await import('./Home.jsx')
const { useStore, DEF } = await import('../store/useStore.js')

const routine = { id: 'r1', name: 'Push', emoji: 'barbell', ex: [{ id: '0025', sets: 3, reps: 8 }] }

const setup = ({ user = null, S = {}, assignments = [] } = {}) => {
  useStore.setState({
    user,
    assignments,
    S: { ...structuredClone(DEF), ...S },
  })
}

let container, root
const text = () => container.textContent

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  PHOTOS = []
  photosFail = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const render = async () => { await act(async () => { root.render(<MemoryRouter><Home /></MemoryRouter>) }) }

describe('somebody with no coach and no plan', () => {
  it('is offered a starter plan, because nobody else is going to write one', async () => {
    setup({ user: { id: 'u1', name: 'Karim' } })
    await render()
    expect(text()).toContain('Load starter plan')
    expect(text()).not.toContain('is preparing your program')
  })
})

describe('somebody whose coach has not sent anything yet', () => {
  it('is told to wait, not invited to build something that is about to be replaced', async () => {
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' } })
    await render()
    expect(text()).toContain('Ahmed is preparing your program')
    expect(text()).not.toContain('Load starter plan')
  })

  it('but an offer waiting is not "preparing" — it is theirs to answer', async () => {
    setup({
      user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' },
      assignments: [{ id: 'a1', coachName: 'Ahmed', note: 'Start here' }],
    })
    await render()
    expect(text()).toContain('Ahmed sent you a program')
    expect(text()).not.toContain('is preparing your program')
    expect(text()).not.toContain('Load starter plan')
  })

  it('and an offer from a coach who is not bound yet still silences it', async () => {
    // An admin can assign a program by hand, without the invite flow, so coachName is null while
    // a real offer sits unanswered. Gating the welcome on coachName alone put "Load starter plan"
    // directly beneath that offer — the same bug as before, one field over. Hence one derived
    // state rather than two conditions that can both be true.
    setup({ user: { id: 'u1', name: 'Karim' }, assignments: [{ id: 'a1', coachName: 'Ahmed', note: 'Block A' }] })
    await render()
    expect(text()).toContain('Ahmed sent you a program')
    expect(text()).not.toContain('Load starter plan')
    expect(text()).not.toContain('is preparing your program')
  })

  it('and once they have routines, neither state applies', async () => {
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' }, S: { routines: [routine] } })
    await render()
    expect(text()).not.toContain('is preparing your program')
    expect(text()).not.toContain('Load starter plan')
  })
})

describe('offers', () => {
  it('shows every one, not just the first', async () => {
    // A coach can send a block and a deload. The old card read assignments[0] and swallowed the
    // rest, so the second program existed only as a dot on a tab.
    setup({
      user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' },
      S: { routines: [routine] },
      assignments: [
        { id: 'a1', coachName: 'Ahmed', note: 'Block A' },
        { id: 'a2', coachName: 'Ahmed', note: 'Deload week' },
      ],
    })
    await render()
    expect(text()).toContain('Block A')
    expect(text()).toContain('Deload week')
  })

  it('is a real button, so it answers to a keyboard', async () => {
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' }, assignments: [{ id: 'a1', coachName: 'Ahmed' }] })
    await render()
    const card = [...container.querySelectorAll('button')].find(b => b.textContent.includes('sent you a program'))
    expect(card).toBeTruthy()
    expect(card.tagName).toBe('BUTTON')
  })
})

describe('daily targets', () => {
  it('are absent until a coach sets them', async () => {
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' }, S: { routines: [routine] } })
    await render()
    expect(text()).not.toContain('Today’s targets')
  })

  it('appear once one arrives, since this is the only screen that states the day', async () => {
    setup({
      user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' },
      S: { routines: [routine], nutriTarget: { kcal: 2400, p: 180 } },
    })
    await render()
    expect(text()).toContain('Today’s targets')
  })
})

describe('progress photos', () => {
  it('are not asked for when no check-in is due', async () => {
    // Also the only thing stopping a network request on every single app launch.
    setup({
      user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' },
      S: { routines: [routine], checkins: [{ d: todayIso(), answers: { energy: 4 } }] },
    })
    await render()
    expect(text()).not.toContain('Progress photos')
  })

  it('are asked for when one is due and none are filed', async () => {
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' }, S: { routines: [routine] } })
    await render()
    expect(text()).toContain('Progress photos')
    expect(text()).toContain('None sent this week')
  })

  it('are never asked of somebody with no coach — they exist to be sent to one', async () => {
    // isCheckinDue is true for anyone who has never filed one, i.e. every plain user, so without
    // this gate the card mounted for all of them — and for a guest, fetchMyPhotos took a 401 on
    // every Home mount before offering an Add button whose sheet only says "sign in".
    setup({ user: { id: 'u1', name: 'Karim' }, S: { routines: [routine] } })
    await render()
    expect(text()).not.toContain('Progress photos')
  })

  it('say nothing at all when the request fails, rather than "none sent"', async () => {
    // Offline or a 5xx would otherwise render exactly the card a genuinely empty week does, so a
    // client who had already sent all three got nagged to send them again.
    photosFail = true
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' }, S: { routines: [routine] } })
    await render()
    expect(text()).not.toContain('Progress photos')
  })

  it('stop asking once all three are in', async () => {
    const { periodStart } = await import('../lib/checkins.js')
    const S = { ...structuredClone(DEF), routines: [routine] }
    const d = periodStart(S, todayIso())
    PHOTOS = [{ id: 'p1', d, pose: 'front' }, { id: 'p2', d, pose: 'side' }, { id: 'p3', d, pose: 'back' }]
    setup({ user: { id: 'u1', name: 'Sara', coachName: 'Ahmed' }, S: { routines: [routine] } })
    await render()
    expect(text()).not.toContain('Progress photos')
  })
})

function todayIso() {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
