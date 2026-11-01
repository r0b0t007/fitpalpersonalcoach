// @vitest-environment happy-dom
//
// Account › My page (CHW-330): the coach's public page — the link in their Instagram bio. The
// handle is checked here as the server checks it; the server's own refusals are shown as they come.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let PAGE = { page: null, url: null }
let SAVE = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/coach/page') { if (PAGE instanceof Error) throw PAGE; return PAGE }
    if (path === '/api/coach/page/save') { if (SAVE instanceof Error) throw SAVE; return SAVE }
    throw new Error('unexpected ' + path)
  },
}))
const { default: PublicPage } = await import('./PublicPage.jsx')

// Where 'See my page' went.
function Where() { return <div>at {useLocation().pathname}</div> }

let container, root
const text = () => container.textContent
const render = async () => {
  await act(async () => {
    root.render(<MemoryRouter><Routes>
      <Route path="/" element={<PublicPage />} />
      <Route path="/c/:handle" element={<Where />} />
    </Routes></MemoryRouter>)
  })
  await act(async () => {})
}
const type = async (selector, value) => {
  const el = container.querySelector(selector)
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = async label => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent.trim() === label)
  if (!b) throw new Error('no button ' + label + ' in: ' + text())
  await act(async () => { b.click() })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; PAGE = { page: null, url: null }; SAVE = null
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('Account › My page', () => {
  it('shows no form it could save blanks from when the page did not load', async () => {
    PAGE = new Error('Network error')
    await render()
    expect(text()).toContain('Network error')
    expect(container.querySelector('input[name="handle"]')).toBe(null)
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save')).toBe(false)
  })

  it('opens the saved page, not the handle half-typed in the field', async () => {
    PAGE = { page: { handle: 'sara.fit', bio: '', whatsapp: '', open: false, theme: 'dark' }, url: 'https://coach.example/c/sara.fit' }
    await render()
    await type('input[name="handle"]', 'sara.coach')
    await click('See my page')
    expect(text()).toContain('at /c/sara.fit')
  })

  it('starts empty for a coach who has none, and saves what they type, read as the server reads it', async () => {
    SAVE = { page: { handle: 'sara.fit', bio: 'Force.', whatsapp: '212612345678', open: true, theme: 'light' }, url: 'https://coach.example/c/sara.fit' }
    await render()
    await type('input[name="handle"]', '@Sara.Fit')
    await type('textarea[name="bio"]', 'Force.')
    await type('input[name="whatsapp"]', '+212 612 345 678')
    await click('Light')
    await click('Save')
    expect(calls.find(([p]) => p === '/api/coach/page/save')[1]).toEqual({ handle: 'sara.fit', bio: 'Force.', whatsapp: '+212 612 345 678', open: true, theme: 'light', starterProgramId: null, autoAccept: false })
    expect(text()).toContain('https://coach.example/c/sara.fit')
  })

  it('keeps the starter program and turns on auto-accept with the page (CHW-338)', async () => {
    PAGE = { page: { handle: 'sara.fit', bio: '', whatsapp: '', open: true, theme: 'dark', starterProgramId: 'p1', autoAccept: false }, url: 'https://coach.example/c/sara.fit' }
    SAVE = PAGE
    await render()
    expect(text()).toContain('Starter program')
    const sw = [...container.querySelectorAll('[role="switch"]')]
    await act(async () => { sw[sw.length - 1].click() })   // the last switch: Accept requests automatically
    await click('Save')
    expect(calls.find(([p]) => p === '/api/coach/page/save')[1]).toMatchObject({ starterProgramId: 'p1', autoAccept: true })
  })

  it('loads the page the coach has, and counts the bio', async () => {
    PAGE = { page: { handle: 'sara.fit', bio: 'Force.', whatsapp: '', open: true, theme: 'dark' }, url: 'https://coach.example/c/sara.fit' }
    await render()
    expect(container.querySelector('input[name="handle"]').value).toBe('sara.fit')
    expect(text()).toContain('6 / 160')
    expect(text()).toContain('See my page')
  })

  it('says what is wrong with a handle before asking the server', async () => {
    await render()
    await type('input[name="handle"]', 'sa')
    await click('Save')
    expect(calls.find(([p]) => p === '/api/coach/page/save')).toBe(undefined)
    expect(text()).toContain('3–30 letters, numbers, dots or underscores')
  })

  it("shows the server's refusal", async () => {
    SAVE = new Error('That handle is taken')
    await render()
    await type('input[name="handle"]', 'sara.fit')
    await click('Save')
    expect(text()).toContain('That handle is taken')
  })
})
