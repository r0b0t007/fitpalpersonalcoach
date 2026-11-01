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
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path.startsWith('/api/public/coach?h=')) return { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'light' } }
    if (path === '/api/join/start') return { ok: true, id: 'req1' }
    if (path === '/api/join/verify') { if (VERIFY instanceof Error) throw VERIFY; return VERIFY }
    if (path.startsWith('/api/join/status?')) { if (STATUS instanceof Error) throw STATUS; return STATUS }
    throw new Error('unexpected ' + path)
  },
}))
const { default: Join } = await import('./Join.jsx')
const { useUI } = await import('../store/useUI.js')

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
const checkConsent = async () => {
  const c = container.querySelector('[role="checkbox"]')
  await act(async () => { c.click() })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; VERIFY = null; STATUS = null
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
    await click('Send me a code')
    const start = calls.find(([p]) => p === '/api/join/start')[1]
    expect(start).toMatchObject({ handle: 'yasmine.fit', name: 'Salma', email: 'salma@example.com', website: '',
      intake: { goal: 'strength', level: 'beginner', days: 3, injuries: 'Genou droit', equipment: ['gym'], phone: '', consent: true } })
    expect(typeof start.elapsed).toBe('number')
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
    await click('Next')
    expect(text()).toContain('Please agree to share your answers with your coach')
    expect(calls.find(([p]) => p === '/api/join/start')).toBe(undefined)
  })

  it('says when the code is wrong, and stays on it', async () => {
    VERIFY = new Error('That code is wrong — check the email and try again')
    await render()
    await click('Get stronger'); await click('Beginner'); await click('3'); await click('Next')
    await checkConsent(); await click('Next')
    await type('input[name="name"]', 'Salma'); await type('input[name="email"]', 'salma@example.com')
    await click('Send me a code')
    await type('input[name="code"]', '000000')
    await click('Send my request')
    expect(text()).toContain('That code is wrong')
    expect(container.querySelector('input[name="code"]')).toBeTruthy()
  })

  it('opens on the request this browser already sent', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = { status: 'pending', coachName: 'Yasmine', handle: 'yasmine.fit' }
    await render()
    expect(text()).toContain('Request sent')
    expect(calls.some(([p]) => p === '/api/join/status?id=req1&token=tok1')).toBe(true)
  })

  it('starts afresh when the stored request is gone', async () => {
    localStorage.setItem('join:yasmine.fit', JSON.stringify({ id: 'req1', token: 'tok1' }))
    STATUS = new Error('No such request')
    await render()
    expect(text()).toContain('Get stronger')
    expect(localStorage.getItem('join:yasmine.fit')).toBe(null)
  })
})
