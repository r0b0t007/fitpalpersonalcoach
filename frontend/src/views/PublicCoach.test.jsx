// @vitest-environment happy-dom
//
// A coach's public page (CHW-330): what someone tapping the link in a coach's Instagram bio sees,
// signed in or not, in the theme the coach chose.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let ANSWER = null
let ASKED = []
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  api: async path => {
    ASKED.push(path)
    if (path.startsWith('/api/public/coach?h=')) { if (ANSWER instanceof Error) throw ANSWER; return ANSWER }
    throw new Error('unexpected ' + path)
  },
}))
const { default: PublicCoach } = await import('./PublicCoach.jsx')
const { useUI } = await import('../store/useUI.js')
const { useStore } = await import('../store/useStore.js')
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
    ASKED = []
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(text()).toContain('Yasmine')
    expect(text()).toContain('Force pour femmes.')
    // Counted as a view of the page, for the coach funnel (CHW-335).
    expect(ASKED).toEqual(['/api/public/coach?h=yasmine.fit&view=1'])
    // A chat with the coach's number, the first line already typed (CHW-341).
    const wa = container.querySelector('a[href^="https://wa.me/212612345678?text="]')
    expect(decodeURIComponent(wa.href.split('text=')[1])).toBe('Hello Yasmine, I found your page on FitPal')
    expect(text()).toContain('Coached with FitPal')
  })

  it('offers no way to ask while the server takes no requests, and WhatsApp stays the main action', async () => {
    useStore.setState({ config: { join_requests: false } })
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '212612345678', theme: 'dark' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(text()).not.toContain('Ask to join')
    expect(container.querySelector('a[href^="https://wa.me/"]').className).toContain('primary')
  })

  it('asks to join from the join form once requests are open, WhatsApp beside it', async () => {
    useStore.setState({ config: { join_requests: true } })
    try {
      let at = null
      const Where = () => { at = useLocation().pathname; return null }
      ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '212612345678', theme: 'dark' } }
      await render(<><PublicCoach handle="yasmine.fit" /><Where /></>)
      expect(container.querySelector('a[href^="https://wa.me/"]').className).not.toContain('primary')
      act(() => root.unmount()); root = createRoot(container)
      // A coach with no number still gets asked: the button never depended on WhatsApp.
      ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'dark' } }
      await render(<><PublicCoach handle="yasmine.fit" /><Where /></>)
      const ask = [...container.querySelectorAll('button')].find(b => b.textContent === 'Ask to join')
      expect(ask.className).toContain('primary')
      await act(async () => { ask.click() })
      expect(at).toBe('/join/yasmine.fit')
    } finally {
      useStore.setState({ config: null })
    }
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

describe('a coach’s public page with their photo (CHW-356)', () => {
  it('lays it full-bleed under the name on Sombre', async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'dark', photo: '/api/public/coach/photo?h=yasmine.fit&v=abc' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    const hero = container.querySelector('.coach-hero')
    expect(hero.querySelector('img').getAttribute('src')).toBe('/api/public/coach/photo?h=yasmine.fit&v=abc')
    expect(hero.querySelector('h1').textContent).toBe('Yasmine')
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })

  it('frames it as a portrait beside the name on Clair', async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'light', photo: '/api/public/coach/photo?h=yasmine.fit&v=abc' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(container.querySelector('.coach-hero')).toBe(null)
    expect(container.querySelector('img.coach-portrait').getAttribute('alt')).toBe('')   // the name is the heading beside it
    expect(container.querySelector('h1').textContent).toBe('Yasmine')
  })

  it('shows the name alone without one', async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'dark', photo: null } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(container.querySelector('img')).toBe(null)
    expect(container.querySelector('h1').textContent).toBe('Yasmine')
  })
})
