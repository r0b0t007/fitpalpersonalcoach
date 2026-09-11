// @vitest-environment happy-dom
//
// The picker is small but it is the whole reason "Send a program" can send a saved one, and a
// component that throws on render takes the client page down with it — the failure mode that
// already cost this branch one round (a helper left behind in another module). Rendering it for
// real is the cheapest guard against a repeat.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../lib/api.js', () => ({ api: async () => ({}) }))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { ProgramPicker } = await import('./ClientDetail.jsx')

const programs = [
  { id: 'p1', name: 'Beginner block A', bundle: { routines: [{ id: 'r1' }] } },
  { id: 'p2', name: 'Upper / lower', bundle: { routines: [{ id: 'r2' }, { id: 'r3' }] } },
]

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const render = onPick => act(() => root.render(<ProgramPicker programs={programs} close={() => {}} onPick={onPick} />))
const rows = () => [...container.querySelectorAll('button')]

describe('choosing what to send', () => {
  it('lists every saved program, with the coach’s current plan last', () => {
    render(() => {})
    expect(rows().map(b => b.querySelector('.small').textContent)).toEqual(['Beginner block A', 'Upper / lower', 'My current plan'])
    expect(rows()[1].textContent).toContain('2 routines')
    expect(rows()[0].textContent).toContain('1 routine')
  })

  it('hands back the program picked, and null for the current plan', () => {
    const picked = []
    render(p => picked.push(p))
    act(() => rows()[1].click())
    act(() => rows()[2].click())
    expect(picked.map(p => p && p.id)).toEqual(['p2', null])
  })
})
