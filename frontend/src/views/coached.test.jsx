// @vitest-environment happy-dom
//
// A coached client's app (CHW-333): Plan reads, never edits; Home moves no day; Settings keeps
// their preferences and export but nothing that undoes the coach's program; Stats keeps their own
// charts; the tab bar reads as the CHW-325 design. And a client their coach released gets every
// one of these back, which is the same render with the coach's name gone.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', async importOriginal => ({
  ...await importOriginal(),
  api: async () => ({}),
  fetchMyPhotos: async () => [],
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { default: Plan } = await import('./Plan.jsx')
const { default: Home } = await import('./Home.jsx')
const { default: Settings } = await import('./Settings.jsx')
const { default: TabBar } = await import('../components/TabBar.jsx')
const { useStore, DEF } = await import('../store/useStore.js')

const routine = { id: 'r1', name: 'Haut du corps', emoji: 'barbell', ex: [{ id: '0025', sets: 3, reps: 8 }] }
const COACHED = { id: 'c1', name: 'Salma', coachName: 'Yasmine' }
const RELEASED = { id: 'c1', name: 'Salma', coachName: null }

let container, root
const text = () => container.textContent
const buttons = () => [...container.querySelectorAll('button')].map(b => b.textContent.trim())
const render = async (el, user) => {
  useStore.setState({ user, assignments: [], healthConsent: { required: !!user?.coachName, consentAt: 1 },
    S: { ...structuredClone(DEF), routines: [routine], week: { 1: ['r1'] } } })
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('a coached client', () => {
  it('reads the coach’s plan and edits none of it', async () => {
    await render(<Plan />, COACHED)
    expect(text()).toContain('Your coach’s program')
    expect(text()).toContain('Haut du corps')
    expect(buttons()).not.toContain('New')
    expect(buttons()).not.toContain('Add routine')
    expect(container.querySelector('[aria-label="Remove"], [aria-label="Exercises"], [aria-label="Share your plan"]')).toBe(null)
    expect(container.querySelector('.item[role="button"]')).toBe(null)
  })

  it('moves no day on Home', async () => {
    await render(<Home />, COACHED)
    expect(container.querySelectorAll('.wday').length).toBe(7)
    expect(container.querySelector('.wday[role="button"]')).toBe(null)
  })

  it('keeps preferences and export in Settings, and drops what undoes the program', async () => {
    await render(<Settings />, COACHED)
    expect(text()).toContain('Export backup (JSON)')
    expect(text()).toContain('Rest timer')
    for (const gone of ['Load starter plan', 'Import from another app', 'Import from Hevy', 'Import backup', 'Reset everything', 'Pair the mobile app']) {
      expect(text()).not.toContain(gone)
    }
  })

  it('has the design’s tabs: Today and Workout', async () => {
    await render(<TabBar onStart={() => {}} />, COACHED)
    const labels = [...container.querySelectorAll('#tabbar > button')].map(b => b.textContent.trim())
    expect(labels).toEqual(['Today', 'Plan', 'Workout', 'Coach', 'You'])
  })
})

describe('a client their coach released', () => {
  it('gets every feature back', async () => {
    await render(<Plan />, RELEASED)
    expect(buttons()).toContain('New')
    expect(container.querySelector('.item[role="button"]')).not.toBe(null)
    act(() => root.unmount()); root = createRoot(container)
    await render(<Settings />, RELEASED)
    for (const back of ['Load starter plan', 'Import backup', 'Reset everything', 'Pair the mobile app']) expect(text()).toContain(back)
    act(() => root.unmount()); root = createRoot(container)
    await render(<Home />, RELEASED)
    expect(container.querySelector('.wday[role="button"]')).not.toBe(null)
    act(() => root.unmount()); root = createRoot(container)
    await render(<TabBar onStart={() => {}} />, RELEASED)
    expect([...container.querySelectorAll('#tabbar > button')].map(b => b.textContent.trim())).toEqual(['Home', 'Plan', 'Start', 'Coach', 'You'])
  })
})
