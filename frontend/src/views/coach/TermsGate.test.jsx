// @vitest-environment happy-dom
//
// The coach terms before the coach's app (CHW-357): asked once, recorded by the server, and never
// a lock when the server cannot be asked.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let TERMS = null
let ACCEPT = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/coach/terms' && !opts) { if (TERMS instanceof Error) throw TERMS; return TERMS }
    if (path === '/api/coach/terms') { if (ACCEPT instanceof Error) throw ACCEPT; return ACCEPT }
    throw new Error('unexpected ' + path)
  },
}))
const { default: TermsGate } = await import('./TermsGate.jsx')

let container, root
const text = () => container.textContent
const render = async () => {
  await act(async () => { root.render(<TermsGate><div>the coach app</div></TermsGate>) })
  await act(async () => {})
}
const click = async el => { await act(async () => { el.click() }); await act(async () => {}) }
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent.includes(label))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; TERMS = null; ACCEPT = null
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('the coach terms gate', () => {
  it('opens the app for a coach who has accepted the current terms', async () => {
    TERMS = { version: '2026-11-01', accepted: true, acceptedAt: 1 }
    await render()
    expect(text()).toContain('the coach app')
  })

  it('asks a coach who has not, and accepts the version it was shown', async () => {
    TERMS = { version: '2026-11-01', accepted: false, acceptedAt: null }
    ACCEPT = { version: '2026-11-01', accepted: true, acceptedAt: 2 }
    await render()
    expect(text()).not.toContain('the coach app')
    expect(container.querySelector('a[href="https://fitpal.ma/en/terms"]')).toBeTruthy()
    await click(button('Accept and continue'))
    expect(text()).toContain('Please accept the coach terms')
    expect(calls.some(([p, b]) => p === '/api/coach/terms' && b)).toBe(false)
    await click(container.querySelector('[role="checkbox"]'))
    await click(button('Accept and continue'))
    expect(calls.find(([p, b]) => p === '/api/coach/terms' && b)[1]).toEqual({ version: '2026-11-01' })
    expect(text()).toContain('the coach app')
  })

  it('says why an acceptance was refused, and stays', async () => {
    TERMS = { version: '2026-11-01', accepted: false, acceptedAt: null }
    ACCEPT = new Error('These terms have changed — read them again')
    await render()
    await click(container.querySelector('[role="checkbox"]'))
    await click(button('Accept and continue'))
    expect(text()).toContain('These terms have changed')
    expect(text()).not.toContain('the coach app')
  })

  it('never locks a coach out when the server cannot be asked', async () => {
    TERMS = new Error('offline')
    await render()
    expect(text()).toContain('the coach app')
  })
})
