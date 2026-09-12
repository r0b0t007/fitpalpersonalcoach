// @vitest-environment happy-dom
//
// The bar is the only way to most of the app, and its failure modes are silent. A route that
// belongs to the You hub but is missing from YOU_ROUTES doesn't throw — the bar just renders with
// nothing selected, which reads as a glitch rather than a bug and is exactly the sort of thing that
// survives a manual pass. So the active-state map is asserted route by route.
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

const { default: TabBar } = await import('./TabBar.jsx')

let container
let root

function render(path) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(
    <MemoryRouter initialEntries={[path]}><TabBar onStart={() => {}} /></MemoryRouter>
  ))
  return container
}

const cells = () => [...container.querySelectorAll('#tabbar > button')]
const labelled = text => cells().find(b => b.textContent.trim() === text)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.assignments = []
  state.user = { id: 'u1', name: 'Ana' }
  state.S.active = null
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('the bar itself', () => {
  it('is five cells: Home, Plan, the Start action, Coach and You — in that order', () => {
    // Sessions left with the gym timetable; the coach dashboards moved to CoachTabBar.jsx.
    // Coach is the client's side of the relationship — /mycoach, not the AI chat at /coach.
    render('/home')
    expect(cells().map(b => b.textContent.trim())).toEqual(['Home', 'Plan', 'Start', 'Coach', 'You'])
  })

  it('the centre cell is the raised action, not a destination', () => {
    render('/home')
    expect(cells()[2].className).toContain('start')
  })
})

describe('what the You hub owns', () => {
  // Each of these lost its own cell, or never had one. Every one must still light the hub.
  for (const [path, label] of [
    ['/you', 'You'], ['/stats', 'You'], ['/history', 'You'], ['/library', 'You'], ['/nutrition', 'You'],
    ['/settings', 'You'], ['/coach', 'You'],
    ['/home', 'Home'], ['/plan', 'Plan'], ['/mycoach', 'Coach'],
  ]) {
    it(`${path} lights ${label}`, () => {
      render(path)
      const lit = cells().filter(b => b.className.split(' ').includes('on'))
      expect(lit.map(b => b.textContent.trim())).toEqual([label])
    })
  }

  it('nested routes light their parent, so /plan/r/:id is still Plan', () => {
    render('/plan/r/abc123')
    const lit = cells().filter(b => b.className.split(' ').includes('on'))
    expect(lit.map(b => b.textContent.trim())).toEqual(['Plan'])
  })
})

describe('the pending-program dot', () => {
  // Before the hub existed a coach's offer was visible only if you happened to be on Home.
  it('is absent with no offer waiting', () => {
    render('/home')
    expect(container.querySelector('.tb-dot')).toBeNull()
  })

  it('appears on Coach when one is, which is where the offer now lives', () => {
    state.assignments = [{ id: 'a1', coachName: 'Coach B' }]
    render('/home')
    const dot = container.querySelector('.tb-dot')
    expect(dot).not.toBeNull()
    expect(labelled('Coach').contains(dot)).toBe(true)
    // And NOT on You: the offer moved off that hub, so a dot there pointed at a screen that no
    // longer carries it.
    expect(labelled('You').contains(dot)).toBe(false)
  })
})

describe('the Start cell reflects a session in progress', () => {
  it('says Start when idle and Resume once one is running', () => {
    render('/home')
    expect(cells()[2].textContent.trim()).toBe('Start')
    act(() => root.unmount())
    container.remove()
    state.S.active = { name: 'Push Day' }
    render('/home')
    expect(cells()[2].textContent.trim()).toBe('Resume')
    expect(cells()[2].className).toContain('rec')
  })
})

describe('signed out', () => {
  it('renders nothing at all when there is neither a user nor a guest', () => {
    state.user = null
    state.isGuest = () => false
    render('/home')
    expect(container.querySelector('#tabbar')).toBeNull()
    state.isGuest = () => false
  })

  it('still renders for a guest, who has an app to use', () => {
    state.user = null
    state.isGuest = () => true
    render('/home')
    expect(container.querySelector('#tabbar')).not.toBeNull()
    state.isGuest = () => false
  })
})
