// @vitest-environment happy-dom
//
// Same reason TabBar.test.jsx exists: a bar with nothing lit, or a cell pointing at the wrong
// place, reads as a glitch and survives a manual pass. The coach bar is also where the raised
// Start cell must NOT appear — its handler starts the coach's own workout, which is the very
// thing the split removes from the coach's screen.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import CoachTabBar from './CoachTabBar.jsx'

let container, root

function render(path) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={[path]}><CoachTabBar /></MemoryRouter>))
}
const cells = () => [...container.querySelectorAll('#tabbar > button')]
const lit = () => cells().filter(b => b.className.split(' ').includes('on')).map(b => b.textContent.trim())

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('the coach bar', () => {
  it('is Today and Account, in that order, until the other screens land', () => {
    render('/today')
    expect(cells().map(b => b.textContent.trim())).toEqual(['Today', 'Account'])
  })

  it('has no raised Start cell — that starts the coach’s own workout', () => {
    render('/today')
    expect(cells().some(b => b.className.includes('start'))).toBe(false)
    expect(container.querySelector('.cir')).toBeNull()
  })

  for (const [path, label] of [['/today', 'Today'], ['/account', 'Account'], ['/', 'Today']]) {
    it(`${path} lights ${label}`, () => {
      render(path)
      expect(lit()).toEqual([label])
    })
  }

  it('lights nothing for a route it has no cell for, rather than guessing', () => {
    render('/admin')
    expect(lit()).toEqual([])
  })
})
