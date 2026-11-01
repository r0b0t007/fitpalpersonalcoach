// @vitest-environment happy-dom
//
// Asking to join a coach (CHW-336): from the coach's page, through a short intake and an emailed
// code, to "Request sent" — with no account, and the request kept in this browser.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let VERIFY = null
let STATUS = null
let START_IDS = []
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path.startsWith('/api/public/coach?h=')) return { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'light' } }
    if (path === '/api/join/start') return { ok: true, id: START_IDS.shift() || 'req-decoy' }
    if (path === '/api/join/verify') { if (VERIFY instanceof Error) throw VERIFY; return VERIFY }
    if (path === '/api/join/status') { if (STATUS instanceof Error) throw STATUS; return STATUS }
    if (path === '/api/join/claim') return { user: { id: 'u1', name: 'Salma', coachName: 'Yasmine' } }
    if (path === '/api/data') return { data: null }
    throw new Error('unexpected ' + path)
  },
}))
// The server's 3 s minimum, shortened so the tests do not wait on it; one test checks it is waited out.
vi.mock('../lib/join.js', async orig => ({ ...(await orig()), MIN_FILL_MS: 50 }))
const { default: Join } = await import('./Join.jsx')
const { useUI } = await import('../store/useUI.js')
const { useStore } = await import('../store/useStore.js')

let container, root
const text = () => container.textContent
const render = async () => {
  await act(async () => { root.render(<MemoryRouter><Join handle="yasmine.fit" /></MemoryRouter>) })
  await act(async () => {})
}
const click = async label => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent.trim() === label)
  if (!b) throw new Error('no button ' + label + ' in: ' + text())
  await act(async () => { b.click() })
  await act(async () => {})
}
const type = async (selector, value) => {
  const el = container.querySelector(selector)
  if (!el) throw new Error('no field ' + selector + ' in: ' + text())
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
// Sending waits out the (shortened) minimum fill time on a timer, which act() does not wait for.
const send = async label => {
  await click(label)
  await act(() => new Promise(r => setTimeout(r, 80)))
}
// The age box and the consent box: both ticked.
const checkConsent = async () => {
  for (const c of container.querySelectorAll('[role="checkbox"]')) await act(async () => { c.click() })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; VERIFY = null; STATUS = null; START_IDS = ['req1']
  localStorage.clear()
  useUI.setState({ themeOverride: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('asking to join a coach', () => {
  it('goes from the intake to an emailed code to "Request sent", and keeps the request', async () => {
    VERIFY = { ok: true, token: 'tok1', status: 'pending' }
    await render()
    expect(text()).toContain('Yasmine')
    expect(useUI.getState().themeOverride).toBe('light')
    await click('Get stronger'); await click('Beginner'); await click('3')
    await click('Next')
    await type('textarea[name="injuries"]', 'Genou droit')
    await click('Gym')
    await checkConsent()
    await click('Next')
    await type('input[name="name"]', 'Salma')
    await type('input[name="email"]', 'salma@example.com')
    await send('Send me a code')
    const start = calls.find(([p]) => p === '/api/join/start')[1]
    expect(start).toMatchObject({ handle: 'yasmine.fit', name: 'Salma', email: 'salma@example.com', 
      intake: { goal: 'strength', level: 'beginner', days: 3, injuries: 'Genou droit', equipment: ['gym'], phone: '', consent: true, over16: true } })
    // Faster than the minimum fill time: the form waited it out instead of being taken for a bot.
    expect(start.elapsed).toBeGreaterThanOrEqual(50)
    expect(start.hp).toBe('')
    await type('input[name="code"]', '123456')
    await click('Send my request')
    expect(calls.find(([p]) => p === '/api/join/verify')[1]).toEqual({ id: 'req1', code: '123456' })
    expect(text()).toContain('Request sent')
    expect(JSON.parse(localStorage.getItem('join:yasmine.fit'))).toEqual({ id: 'req1', token: 'tok1' })
  })

  it('asks for consent before anything is sent', async () => {
    await render()
    await click('Get stronger'); await click('Beginner'); await click('3')
    await click('Next')
    const [age] = container.querySelectorAll('[role="checkbox"]')
    await act(async () => { age.click() })
    await click('Next')
    expect(text()).toContain('Please agree to share your answers with your coach')
    expect(calls.find(([p]) => p === '/api/join/start')).toBe(undefined)
  })

  it('asks the follower to confirm they are 16 or older', async () => {
    await render()
    await click('Get stronger'); await click('Beginner'); await click('3')
    await click('Next')
    // Nothing ticked: the age box comes first, as on the form; each box is named by its text.
    const [age, consent] = container.querySelectorAll('[role="checkbox"]')
    expect(container.querySelector('#' + age.getAttribute('aria-labelledby')).textContent).toBe('I am 16 or older')
    expect(consent.getAttribute('aria-labelledby')).toBe('join-consent')
    await click('Next')
    expect(text()).toContain('You must be 16 or older to ask')
    expect(calls.find(([p]) => p === '/api/join/start')).toBe(undefined)
  })

  it('says when the code is wrong, and stays on it', async () => {
    VERIFY = new Error('That code is wrong — check the email and try again')
    await render()
    await click('Get stronger'); await click('Beginner'); await click('3'); await click('Next')
    await checkConsent(); await click('Next')
    await type('input[name="name"]', 'Salma'); await type('input[name="email"]', 'salma@example.com')
    await send('Send me a code')
    await type('input[name="code"]', '000000')
    await click('Send my request')
    expect(text()).toContain('That code is wrong')
    expect(container.querySelector('input[name="code"]')).toBeTruthy()
  })

  it('opens on the request this browser already sent', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = { status: 'pending', coachName: 'Yasmine', handle: 'yasmine.fit', theme: 'light' }
    await render()
    expect(text()).toContain('Request sent')
    expect(text()).toContain('Yasmine')
    // Posted, never in a URL; and read before the page, which may have closed since.
    expect(calls.find(([p]) => p === '/api/join/status')[1]).toEqual({ id: 'req1', token: 'tok1' })
    expect(calls.some(([p]) => p.startsWith('/api/public/coach'))).toBe(false)
    expect(useUI.getState().themeOverride).toBe('light')
  })

  it('starts afresh when the stored request is gone', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = Object.assign(new Error('No such request'), { status: 404 })
    await render()
    expect(text()).toContain('Get stronger')
    expect(localStorage.getItem('join:yasmine.fit')).toBe(null)
  })

  it('never writes the profile this browser held before into the account of the follower', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = { status: 'accepted', coachName: 'Yasmine', handle: 'yasmine.fit', theme: 'dark' }
    useStore.setState(s => ({ user: { id: 'someone-else' }, S: { ...s.S, workouts: [{ id: 'w1', date: '2026-10-01' }] } }))
    await render()
    await click('Start training')
    expect(calls.filter(([p, body]) => p === '/api/data' && body !== undefined)).toEqual([])
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().user).toMatchObject({ id: 'u1' })
  })
})

describe('while the request waits', () => {
  it('looks again for the answer, so an accept shows without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
      STATUS = { status: 'pending', coachName: 'Yasmine', handle: 'yasmine.fit', theme: 'dark' }
      await render()
      expect(text()).toContain('Request sent')
      STATUS = { ...STATUS, status: 'accepted' }
      await act(async () => { vi.advanceTimersByTime(21_000) })
      await act(async () => {})
      expect(text()).toContain('Yasmine accepted you')
    } finally { vi.useRealTimers() }
  })

  it('says so, and forgets the request, when it is gone while waiting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
      STATUS = { status: 'pending', coachName: 'Yasmine', handle: 'yasmine.fit', theme: 'dark' }
      await render()
      STATUS = Object.assign(new Error('No such request'), { status: 404 })
      await act(async () => { vi.advanceTimersByTime(21_000) })
      await act(async () => {})
      expect(text()).toContain('No such request')
      expect(localStorage.getItem('join:yasmine.fit')).toBe(null)
    } finally { vi.useRealTimers() }
  })
})

describe('asking to join, when things go wrong', () => {
  it('keeps the stored request through a server error or no connection, and says so', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = Object.assign(new Error('Service unavailable'), { status: 503 })
    await render()
    expect(text()).toContain('Service unavailable')
    expect(JSON.parse(localStorage.getItem('join:yasmine.fit'))).toEqual({ id: 'req1', token: 'tok1' })
  })

  it('keeps the request it started when the code is sent again', async () => {
    START_IDS = ['req1', 'req-decoy']   // the resend was throttled: the server answers with nothing real
    VERIFY = { ok: true, token: 'tok1', status: 'pending' }
    await render()
    await click('Get stronger'); await click('Beginner'); await click('3'); await click('Next')
    await checkConsent(); await click('Next')
    await type('input[name="name"]', 'Salma'); await type('input[name="email"]', 'salma@example.com')
    await send('Send me a code')
    await send('Send the code again')
    await type('input[name="code"]', '123456')
    await click('Send my request')
    expect(calls.find(([p]) => p === '/api/join/verify')[1]).toEqual({ id: 'req1', code: '123456' })
  })
})

describe('once the coach has accepted', () => {
  it('signs the follower in from the request, once, and forgets it', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = { status: 'accepted', coachName: 'Yasmine', handle: 'yasmine.fit', theme: 'dark' }
    useStore.setState({ user: null })
    await render()
    expect(text()).toContain('Yasmine accepted you')
    await click('Start training')
    expect(calls.find(([p]) => p === '/api/join/claim')[1]).toEqual({ id: 'req1', token: 'tok1' })
    expect(useStore.getState().user).toMatchObject({ id: 'u1', coachName: 'Yasmine' })
    expect(localStorage.getItem('join:yasmine.fit')).toBe(null)
  })
})
