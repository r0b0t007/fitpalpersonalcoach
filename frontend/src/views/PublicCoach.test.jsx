// @vitest-environment happy-dom
//
// A coach's public page (CHW-330): what someone tapping the link in a coach's Instagram bio sees,
// signed in or not, in the theme the coach chose.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let ANSWER = null
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  api: async path => {
    if (path.startsWith('/api/public/coach?h=')) { if (ANSWER instanceof Error) throw ANSWER; return ANSWER }
    throw new Error('unexpected ' + path)
  },
}))
const { default: PublicCoach } = await import('./PublicCoach.jsx')
const { useUI } = await import('../store/useUI.js')
const { saveRequest } = await import('../lib/join.js')

let container, root
const text = () => container.textContent
const render = async el => {
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
  await act(async () => {})
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.documentElement.dataset.theme = 'dark'
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe("a coach's public page", () => {
  it('shows the coach, their bio, and WhatsApp when they gave a number', async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: 'Force pour femmes.', whatsapp: '212612345678', theme: 'dark' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(text()).toContain('Yasmine')
    expect(text()).toContain('Force pour femmes.')
    expect(container.querySelector('a[href="https://wa.me/212612345678"]')).toBeTruthy()
    expect(text()).toContain('Coached with FitPal')
    // No way to ask that leads nowhere: asking to join arrives with the join flow (CHW-336).
    expect(text()).not.toContain('Ask to join')
  })

  it("asks App for the coach's theme while it is open, and hands the person's own back after", async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'light' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(useUI.getState().themeOverride).toBe('light')
    expect(container.querySelector('a[href^="https://wa.me"]')).toBe(null)
    act(() => root.unmount()); root = createRoot(container)
    expect(useUI.getState().themeOverride).toBe(null)
  })

  it('suggests Safari inside Instagram, but not once this browser has sent the coach a request', async () => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Instagram 330.0', configurable: true })
    try {
      ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'dark' } }
      await render(<PublicCoach handle="yasmine.fit" />)
      expect(container.querySelector('a[href^="x-safari-"]').getAttribute('href')).toMatch(/\/c\/yasmine\.fit$/)
      act(() => root.unmount()); root = createRoot(container)
      // A request sent from here is followed from this browser's storage: no sending them away.
      saveRequest('yasmine.fit', { id: 'r1', token: 't1' })
      await render(<PublicCoach handle="yasmine.fit" />)
      expect(text()).toContain('Yasmine')
      expect(container.querySelector('a[href^="x-safari-"]')).toBe(null)
    } finally {
      delete navigator.userAgent
      if (desc) Object.defineProperty(Navigator.prototype, 'userAgent', desc)
      localStorage.clear()
    }
  })

  it('says why there is nothing to show', async () => {
    ANSWER = new Error('This coach is not taking requests right now')
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(text()).toContain('This coach is not taking requests right now')
  })
})
