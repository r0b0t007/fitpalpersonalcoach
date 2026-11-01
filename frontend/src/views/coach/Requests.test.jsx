// @vitest-environment happy-dom
//
// The coach's requests inbox (CHW-337): who asked to train with them, what they answered, and
// Accept / Decline — the server decides the seat; the screen shows its answer.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
const salma = { id: 'r1', name: 'Salma', email: 'salma@example.com', status: 'pending', created: Date.now() - 3_600_000, decided: null,
  intake: { goal: 'strength', level: 'beginner', days: 3, injuries: 'Genou droit', equipment: ['gym', 'home'], phone: '212612345678' } }
let LIST = [salma]
let DECIDE = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/coach/requests') return { requests: LIST }
    if (path === '/api/coach/requests/count') return { pending: LIST.filter(r => r.status === 'pending').length }
    if (path === '/api/coach/requests/decide') { if (DECIDE instanceof Error) throw DECIDE; return DECIDE }
    throw new Error('unexpected ' + path)
  },
}))
const { default: Requests, usePendingRequests } = await import('./Requests.jsx')

let container, root
const text = () => container.textContent
const render = async () => {
  await act(async () => { root.render(<MemoryRouter><Requests /></MemoryRouter>) })
  await act(async () => {})
}
const click = async label => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent.trim() === label || x.textContent.includes(label))
  if (!b) throw new Error('no button ' + label + ' in: ' + text())
  await act(async () => { b.click() })
  await act(async () => {})
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; LIST = [salma]; DECIDE = null
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('the requests inbox', () => {
  it('shows who asked, and what they answered', async () => {
    await render()
    expect(text()).toContain('Salma')
    expect(text()).toContain('Get stronger')
    await click('Salma')
    expect(text()).toContain('Genou droit')
    expect(text()).toContain('Beginner')
    expect(text()).toContain('At home')
    expect(container.querySelector('a[href="https://wa.me/212612345678"]')).toBeTruthy()
  })

  it('accepts, and shows the inbox the server sends back', async () => {
    DECIDE = { requests: [{ ...salma, status: 'accepted', decided: Date.now() }], member: { id: 'u1', name: 'Salma' } }
    await render()
    await click('Salma')
    await click('Accept')
    expect(calls.find(([p]) => p === '/api/coach/requests/decide')[1]).toEqual({ id: 'r1', accept: true })
    expect(text()).toContain('Accepted')
  })

  it('declines', async () => {
    DECIDE = { requests: [{ ...salma, status: 'declined', decided: Date.now() }], member: null }
    await render()
    await click('Salma')
    await click('Decline')
    expect(calls.find(([p]) => p === '/api/coach/requests/decide')[1]).toEqual({ id: 'r1', accept: false })
    expect(text()).toContain('Declined')
  })

  it('says why an accept was refused, and keeps the request', async () => {
    DECIDE = new Error('Your plan allows 3 clients — upgrade to accept more')
    await render()
    await click('Salma')
    await click('Accept')
    expect(text()).toContain('Your plan allows 3 clients')
    expect(text()).toContain('Salma')
  })

  it('reads the inbox again after a refusal, so a lapsed request leaves the waiting list', async () => {
    DECIDE = new Error('They already train with another coach')
    await render()
    await click('Salma')
    LIST = [{ ...salma, status: 'expired', decided: Date.now() }]
    await click('Accept')
    expect(text()).toContain('They already train with another coach')
    expect(text()).toContain('Lapsed')
    expect([...container.querySelectorAll('button')].some(b => b.textContent.includes('Accept'))).toBe(false)
  })

  it('counts the waiting requests for Today from the count route, not the inbox', async () => {
    let n
    const Probe = () => { n = usePendingRequests(); return null }
    await act(async () => { root.render(<Probe />) })
    await act(async () => {})
    expect(n).toBe(1)
    expect(calls.map(([p]) => p)).toEqual(['/api/coach/requests/count'])
  })

  it('opens someone accepted for what they said, without the buttons; a no stays shut', async () => {
    LIST = [{ ...salma, status: 'accepted', decided: Date.now() }, { ...salma, id: 'r2', name: 'Karim', status: 'declined', intake: {}, decided: Date.now() }]
    await render()
    await click('Salma')
    expect(text()).toContain('Genou droit')
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === 'Accept')).toBe(false)
    const karim = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Karim'))
    expect(karim.disabled).toBe(true)
  })

  it('says so when nobody has asked yet', async () => {
    LIST = []
    await render()
    expect(text()).toContain('No requests yet')
  })
})
