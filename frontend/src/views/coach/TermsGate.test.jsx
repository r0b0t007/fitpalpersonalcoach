// @vitest-environment happy-dom
//
// The coach terms before the coach's app (CHW-357): asked once, nothing of the roster shown before
// the answer, a newer version picked up when one is published meanwhile, and never a lock when the
// server cannot be asked.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let TERMS = null          // what GET answers: a value, an Error, or a promise held back
let ACCEPT = null         // what POST answers
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/coach/terms' && !opts) { const r = await TERMS; if (r instanceof Error) throw r; return r }
    if (path === '/api/coach/terms') { if (ACCEPT instanceof Error) throw ACCEPT; return ACCEPT }
    throw new Error('unexpected ' + path)
  },
}))
const { default: TermsGate, TermsWaiting, useCoachTerms } = await import('./TermsGate.jsx')

// As App draws the coach shell.
function Shell() {
  const [terms, setTerms] = useCoachTerms(true, 'u1')
  return !terms ? <TermsWaiting /> : terms.accepted ? <div>the coach app</div> : <TermsGate terms={terms} onChange={setTerms} />
}

let container, root
const text = () => container.textContent
const render = async () => {
  await act(async () => { root.render(<Shell />) })
  await act(async () => {})
}
const click = async el => { await act(async () => { el.click() }); await act(async () => {}) }
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent.includes(label))
const posts = () => calls.filter(([p, b]) => p === '/api/coach/terms' && b).map(([, b]) => b)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; TERMS = null; ACCEPT = null
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('the coach terms', () => {
  it('shows nothing of the coach app until the server has answered', async () => {
    let answer
    TERMS = new Promise(r => { answer = r })
    await render()
    expect(text()).not.toContain('the coach app')
    await act(async () => { answer({ version: '2026-11-01', accepted: true, acceptedAt: 1 }) })
    await act(async () => {})
    expect(text()).toContain('the coach app')
  })

  it('asks a coach who has not accepted, and accepts the version shown', async () => {
    TERMS = { version: '2026-11-01', accepted: false, acceptedAt: null }
    ACCEPT = { version: '2026-11-01', accepted: true, acceptedAt: 2 }
    await render()
    expect(text()).not.toContain('the coach app')
    expect(container.querySelector('a[href="https://fitpal.ma/en/terms"]')).toBeTruthy()
    expect(text()).toContain('contact@fitpal.ma')   // the way out, as the terms promise
    await click(button('Accept and continue'))
    expect(text()).toContain('Please accept the coach terms')
    expect(posts()).toEqual([])
    await click(container.querySelector('[role="checkbox"]'))
    await click(button('Accept and continue'))
    expect(posts()).toEqual([{ version: '2026-11-01' }])
    expect(text()).toContain('the coach app')
  })

  it('picks up a version published while the screen was open, to be read and accepted again', async () => {
    TERMS = { version: '2026-11-01', accepted: false, acceptedAt: null }
    ACCEPT = Object.assign(new Error('These terms have changed — read them again'), { status: 409 })
    await render()
    await click(container.querySelector('[role="checkbox"]'))
    TERMS = { version: '2026-12-15', accepted: false, acceptedAt: null }
    await click(button('Accept and continue'))
    expect(text()).toContain('These terms have changed')
    expect(container.querySelector('[role="checkbox"]').getAttribute('aria-checked')).toBe('false')
    ACCEPT = { version: '2026-12-15', accepted: true, acceptedAt: 3 }
    await click(container.querySelector('[role="checkbox"]'))
    await click(button('Accept and continue'))
    expect(posts()).toEqual([{ version: '2026-11-01' }, { version: '2026-12-15' }])
    expect(text()).toContain('the coach app')
  })

  it('never locks a coach out when the server cannot be asked', async () => {
    TERMS = new Error('offline')
    await render()
    expect(text()).toContain('the coach app')
  })
})
