// @vitest-environment happy-dom
//
// Its own file because MOBILE is a module-level constant: the flag has to be mocked before
// TabBar is imported, and the web-build suite next door needs it false.
//
// The standalone builds have no server to hold a timetable, so Sessions is absent and the bar is
// four cells. Worth pinning: the condition is easy to disturb while rearranging the others, and
// the failure — a tab that opens a permanently empty screen — is invisible from a web checkout.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const state = {
  S: { active: null, routines: [], week: {}, dayPlan: {}, workouts: [] },
  user: { id: 'u1', name: 'Ana' },
  assignments: [],
  isGuest: () => false,
}

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector(state) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true,
  initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { default: TabBar } = await import('./TabBar.jsx')

let container
let root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(
    <MemoryRouter initialEntries={['/home']}><TabBar onStart={() => {}} /></MemoryRouter>
  ))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('the standalone mobile build', () => {
  const cells = () => [...container.querySelectorAll('#tabbar > button')]

  it('drops Sessions, leaving four cells', () => {
    expect(cells().map(b => b.textContent.trim())).toEqual(['Home', 'Plan', 'Start', 'You'])
  })

  it('still keeps the hub, which is now the only way to Stats and Exercises', () => {
    expect(cells().some(b => b.textContent.trim() === 'You')).toBe(true)
  })
})
