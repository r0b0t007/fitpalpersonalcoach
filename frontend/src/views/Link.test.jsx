// @vitest-environment happy-dom
//
// Sign-in by emailed link (R4, Laravel only): the landing page's three outcomes, the Login form's
// "Check your inbox", the Account email row and the passkey offer after a link sign-in. And the
// line every one of them holds first: on a server with no `login_email` in its config (mail not
// set up, or the Node API it replaced), none of it shows.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let REDEEM = null      // what POST /api/login/link answers: an object, or an Error to throw
let ACCOUNT = null     // GET /api/account
let CODE = null        // what POST /api/login/code answers: an object, or an Error to throw
let UA = ''            // the user agent inapp.js reads
// The helpers are rebuilt on the mocked api(): the originals would call the real one, and fetch.
vi.mock('../lib/api.js', async orig => {
  const post = (path, body) => mockApi(path, { method: 'POST', body: JSON.stringify(body) })
  const mockApi = async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/login/link') { if (REDEEM instanceof Error) throw REDEEM; return REDEEM }
    if (path === '/api/login/email') return { ok: true }
    if (path === '/api/login/code') { if (CODE instanceof Error) throw CODE; return CODE }
    if (path === '/api/account') return ACCOUNT
    if (path === '/api/account/email') return { ok: true, pendingEmail: JSON.parse(opts.body).email }
    if (path === '/api/data') return { state: null }
    if (path === '/api/assignments') return { assignments: [] }
    throw new Error('unexpected ' + path)
  }
  return {
    ...(await orig()),
    api: mockApi,
    requestLoginLink: email => post('/api/login/email', { email }),
    redeemLoginLink: t => post('/api/login/link', { t }),
    signInWithCode: (email, code) => post('/api/login/code', { email, code }),
    fetchAccount: () => mockApi('/api/account'),
    changeEmail: email => post('/api/account/email', { email }),
    webauthnOK: () => true,
  }
})
// Login's code-first layout follows this; the open-in-browser card is OpenInBrowser.test's.
vi.mock('../lib/inapp.js', async orig => ({ ...(await orig()), inAppBrowser: () => /Instagram/.test(UA), inAppPlatform: () => null }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: Link, linkOpen, SIGNED_IN_MS } = await import('./Link.jsx')
const { default: Login } = await import('./Login.jsx')
const { EmailRow } = await import('./coach/EmailRow.jsx')
const { AddPasskeySheet, shouldOfferPasskey } = await import('../components/AddPasskeySheet.jsx')

const LARAVEL = { invite_only: true, allow_guest: false, login_email: true }
const NODE = { invite_only: true, allow_guest: false, request_access: false }
const COACH = { id: 'c1', name: 'Ahmed', coach: true }

let container, root, where
const text = () => container.textContent
const Where = () => { where = useLocation(); return null }
const render = async (el, path) => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<>{el}<Where /></>} /></Routes></MemoryRouter>)
  })
  await act(async () => {})
}
const click = async label => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent.trim() === label)
  if (!b) throw new Error('no button ' + label + ' in: ' + text())
  await act(async () => { b.click() })
}
const type = async (sel, value) => {
  const input = container.querySelector(sel)
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const serverError = (status, message) => Object.assign(new Error(message), { status })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  REDEEM = null; ACCOUNT = null; CODE = null; UA = ''
  localStorage.clear()
  useStore.setState({ user: null, config: LARAVEL })
  useUI.setState({ sheets: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

describe('without login_email in /api/config', () => {
  it('the link page is not one, and Login offers no email path', async () => {
    expect(linkOpen(NODE)).toBe(false)
    expect(linkOpen(LARAVEL)).toBe(true)
    useStore.setState({ config: NODE })
    await render(<Login />, '/home')
    expect(text()).not.toContain('Get a code by email')
  })

  it('Account has no email row', async () => {
    useStore.setState({ config: NODE, user: COACH })
    await render(<EmailRow />, '/account')
    expect(calls).toEqual([])
    expect(text()).toBe('')
  })
})

describe('the link page', () => {
  it('signs in, says so, then moves on to Today and offers a passkey', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    REDEEM = { user: COACH }
    await render(<Link />, '/link?t=tok_signin')
    expect(calls.filter(([p]) => p === '/api/login/link')).toEqual([['/api/login/link', { t: 'tok_signin' }]])
    expect(text()).toContain('You are signed in')
    expect(useStore.getState().user).toMatchObject({ id: 'c1' })
    await act(async () => { vi.advanceTimersByTime(SIGNED_IN_MS + 50) })
    // On to Today, which also takes the spent token out of the address.
    expect(where.pathname).toBe('/today')
    expect(where.search).toBe('')
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('drops the previous profile’s local data when another account signs in by link', async () => {
    // Someone else was signed in on this device. The session is already the new coach's: their
    // local state must go, not be pushed into the new account by the sync after sign-in.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useStore.setState({ user: { id: 'other', name: 'Someone else', coach: false } })
    // An edit whose debounced push is still waiting when the link signs the other coach in.
    useStore.getState().update(st => { st.workouts = [{ id: 'w1', date: '2026-09-01', ex: [] }] })
    localStorage.setItem('gym_dirty', '1')
    REDEEM = { user: COACH }
    await render(<Link />, '/link?t=tok_switch')
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(useStore.getState().user).toMatchObject({ id: 'c1' })
    expect(useStore.getState().S.workouts || []).toEqual([])
    // No push at all — neither the old profile's state nor the emptied one — under the new session.
    expect(calls.some(([p, b]) => p === '/api/data' && b)).toBe(false)
  })

  it('tries again when the same link is opened after the server could not be reached', async () => {
    REDEEM = new Error('Failed to fetch')   // no status: never reached the server
    await render(<Link />, '/link?t=tok_offline')
    expect(text()).toContain('Could not reach the server')
    act(() => root.unmount()); root = createRoot(container)
    REDEEM = { user: COACH }
    await render(<Link />, '/link?t=tok_offline')
    expect(text()).toContain('You are signed in')
    expect(calls.filter(([p]) => p === '/api/login/link')).toHaveLength(2)
  })

  it('redeems a token once, however often the page mounts', async () => {
    REDEEM = { user: COACH }
    await render(<Link />, '/link?t=tok_twice')
    act(() => root.unmount())
    root = createRoot(container)
    await render(<Link />, '/link?t=tok_twice')
    expect(calls.filter(([p]) => p === '/api/login/link')).toHaveLength(1)
  })

  it('says an old link no longer works, in the server’s words, with a way to a new one', async () => {
    REDEEM = serverError(400, 'this sign-in link was already used')
    await render(<Link />, '/link?t=tok_used')
    expect(text()).toContain('This link no longer works')
    expect(text()).toContain('this sign-in link was already used')
    await click('Get a new link')
    expect(where.pathname + where.search).toBe('/home?email=1')
  })

  it('treats a link with no token as one that no longer works, and asks the server nothing', async () => {
    await render(<Link />, '/link')
    expect(text()).toContain('This link no longer works')
    expect(text()).toContain('Sign-in links work once, for 15 minutes.')
    expect(calls).toEqual([])
  })

  it('confirms an address change', async () => {
    useStore.setState({ user: COACH })
    REDEEM = { ok: true, email: 'new@example.com' }
    await render(<Link />, '/link?t=tok_email')
    expect(text()).toContain('Email changed')
    expect(text()).toContain('Sign-in links now go to new@example.com.')
    await click('Back to Account')
    expect(where.pathname).toBe('/account')
  })
})

describe('Login’s email path', () => {
  it('accepts an ordinary address with an "s" in it', async () => {
    // The regression: a copy of the address check that had lost its backslashes refused these.
    await render(<Login />, '/home?email=1')
    await type('input[type="email"]', 'sara@fitness.ma')
    await click('Send me a code')
    expect(calls.find(([p]) => p === '/api/login/email')[1]).toEqual({ email: 'sara@fitness.ma' })
  })

  it('sends a code and says the same thing whoever the address belongs to', async () => {
    await render(<Login />, '/home')
    await click('Get a code by email')
    await type('input[type="email"]', 'coach@example.com')
    await click('Send me a code')
    expect(calls.find(([p]) => p === '/api/login/email')[1]).toEqual({ email: 'coach@example.com' })
    expect(text()).toContain('Check your inbox')
    expect(text()).toContain('If that address has an account, a 6-digit code is on its way to coach@example.com')
    await click('Use another address')
    expect(container.querySelector('input[type="email"]').value).toBe('')
  })

  it('opens the form straight away when the link page sent the coach for a new link', async () => {
    await render(<Login />, '/home?email=1')
    expect(container.querySelector('input[type="email"]')).toBeTruthy()
  })

  it('asks for an address before sending anything', async () => {
    await render(<Login />, '/home?email=1')
    await type('input[type="email"]', 'not-an-address')
    await click('Send me a code')
    expect(calls.find(([p]) => p === '/api/login/email')).toBe(undefined)
  })
})

describe('Login’s code (CHW-331)', () => {
  const askCode = async () => {
    await render(<Login />, '/home?email=1')
    await type('input[type="email"]', 'sara@fitness.ma')
    await click('Send me a code')
  }

  it('signs in with the code typed in this browser, and offers a passkey after', async () => {
    CODE = { user: { id: 'u1', name: 'Sara', coachName: 'Yasmine' } }
    await askCode()
    expect([...container.querySelectorAll('button')].find(b => b.textContent === 'Sign in').disabled).toBe(true)
    await type('input[name="code"]', '48 29-13x')   // digits only, however it was pasted
    expect(container.querySelector('input[name="code"]').value).toBe('482913')
    await click('Sign in')
    expect(calls.find(([p]) => p === '/api/login/code')[1]).toEqual({ email: 'sara@fitness.ma', code: '482913' })
    expect(useStore.getState().user.id).toBe('u1')
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('says what the server said about a wrong code, and offers no passkey inside Instagram', async () => {
    CODE = serverError(400, 'that code is wrong — check the email and try again')
    await askCode()
    await type('input[name="code"]', '000000')
    await click('Sign in')
    expect(text()).toContain('that code is wrong')
    expect(useStore.getState().user).toBe(null)
    UA = 'Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 330.0'
    CODE = { user: { id: 'u1', name: 'Sara' } }
    await click('Sign in')
    expect(useStore.getState().user.id).toBe('u1')
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('puts the code first inside Instagram, where a passkey fails', async () => {
    UA = 'Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 330.0'
    await render(<Login />, '/home')
    expect(container.querySelector('input[type="email"]')).toBeTruthy()
    expect(text()).not.toContain('Get a code by email')
    expect([...container.querySelectorAll('button')].find(b => b.textContent === 'Sign in with passkey').className).not.toContain('primary')
  })

  it('sends the code again from the same screen', async () => {
    await askCode()
    await click('Send the code again')
    expect(calls.filter(([p]) => p === '/api/login/email')).toHaveLength(2)
  })
})

describe('Account › email row', () => {
  beforeEach(() => useStore.setState({ user: COACH }))

  it('shows a confirmed address', async () => {
    ACCOUNT = { email: 'a@example.com', pendingEmail: null, verified: true }
    await render(<EmailRow />, '/account')
    expect(text()).toContain('a@example.com')
    expect(text()).toContain('Verified · for sign-in links and receipts')
  })

  it('lets a new sign-up correct a mistyped address', async () => {
    ACCOUNT = { email: null, pendingEmail: 'ahmed@gmial.com', verified: false }
    await render(<EmailRow />, '/account')
    await click('Change')
    expect(useUI.getState().sheets).toHaveLength(1)
    // Two buttons beside the row, not a button inside a button.
    expect(container.querySelector('button button')).toBe(null)
  })

  it('offers to resend the first link to a new sign-up', async () => {
    ACCOUNT = { email: null, pendingEmail: 'new@example.com', verified: false }
    await render(<EmailRow />, '/account')
    expect(text()).toContain('Not confirmed yet — open the link we sent')
    await click('Resend')
    expect(calls.find(([p]) => p === '/api/account/email')[1]).toEqual({ email: 'new@example.com' })
  })

  it('shows a change waiting for its link, under the address still in force', async () => {
    ACCOUNT = { email: 'a@example.com', pendingEmail: 'b@example.com', verified: true }
    await render(<EmailRow />, '/account')
    expect(text()).toContain('a@example.com')
    expect(text()).toContain('Waiting for confirmation of b@example.com')
    expect(text()).toContain('pending')
  })

  it('invites an older account to add one', async () => {
    ACCOUNT = { email: null, pendingEmail: null, verified: false }
    await render(<EmailRow />, '/account')
    expect(text()).toContain('Add an email')
  })

  it('is not there for a client', async () => {
    useStore.setState({ user: { id: 'm1', name: 'Sara', coach: false } })
    await render(<EmailRow />, '/account')
    expect(calls).toEqual([])
  })
})

describe('the passkey offer', () => {
  it('is made once per device: "Not now" is remembered', async () => {
    expect(shouldOfferPasskey()).toBe(true)
    const close = vi.fn()
    await render(<AddPasskeySheet close={close} />, '/today')
    await click('Not now')
    expect(close).toHaveBeenCalled()
    expect(shouldOfferPasskey()).toBe(false)
  })
})
