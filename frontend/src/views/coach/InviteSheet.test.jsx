// @vitest-environment happy-dom
//
// Making an invite must finish even when the browser will not help send it.
//
// navigator.share and navigator.clipboard both need transient user activation, which the network
// round trip in the middle of minting can spend — and their two failure modes are not alike.
// share REJECTS (NotAllowedError). clipboard.writeText simply never settles when the document is
// not focused: no resolve, no reject, ever. Awaiting that left the button reading "Making…" for
// good, with a code that existed on the server and nothing on screen to show it, which is the
// worst shape this feature can fail in — the coach makes another, and another.
//
// So: minting never waits on sending. These tests hold that line.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let inviteState = { invites: [], inviteOnly: false, max: 20 }
let listFails = false
let mintFails = ''
vi.mock('../../lib/api.js', () => ({
  api: async (path, opts) => {
    calls.push(path)
    if (path === '/api/coach/invites') {
      if (listFails) throw new Error('not signed in')
      return inviteState
    }
    if (path === '/api/coach/invites/new') {
      if (mintFails) throw new Error(mintFails)
      const invite = { code: 'NEWCODE000000001', note: JSON.parse(opts.body).note, created: '2026-09-11T00:00:00.000Z' }
      inviteState = { ...inviteState, invites: [...inviteState.invites, invite] }
      return { invite }
    }
    throw new Error('unexpected ' + path)
  },
  fetchExerciseMedia: async () => ({ rows: [] }),
  uploadExerciseMedia: async () => ({}),
}))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { InviteSheet } = await import('./sheets.jsx')
const { useStore } = await import('../../store/useStore.js')

let container, root
const text = () => container.textContent
// navigator.clipboard is an accessor with no setter, so plain assignment throws.
const setClipboard = value => Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  inviteState = { invites: [], inviteOnly: false, max: 20 }
  listFails = false; mintFails = ''
  setClipboard({ writeText: async () => {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount()); container.remove()
  delete navigator.share
  vi.useRealTimers()
})

const mount = async () => { await act(async () => { root.render(<InviteSheet />) }) }
const makeButton = () => [...container.querySelectorAll('button')].find(b => /Make an invite link|Making/.test(b.textContent))

describe('making an invite link', () => {
  it('finishes and lists the link even when the clipboard never answers', async () => {
    // The exact hang: a promise with no outcome. If mint awaited this, nothing below would pass.
    setClipboard({ writeText: () => new Promise(() => {}) })
    await mount()
    await act(async () => { makeButton().click() })
    expect(makeButton().textContent).toContain('Make an invite link')   // not stuck on "Making…"
    expect(makeButton().disabled).toBe(false)
    expect(text()).toContain('NEWCODE000000001')                        // and the coach can see it
  })

  it('finishes when the share sheet refuses outright, as it does once an await has spent the tap', async () => {
    navigator.share = () => Promise.reject(Object.assign(new Error('nope'), { name: 'NotAllowedError' }))
    setClipboard({ writeText: async () => {} })
    await mount()
    await act(async () => { makeButton().click() })
    expect(makeButton().disabled).toBe(false)
    expect(text()).toContain('NEWCODE000000001')
  })

  it('re-enables the button when the server refuses, so a coach can retry', async () => {
    await mount()
    // At the lifetime cap the server answers 429. Leaving the button disabled after a refusal
    // strands a coach on the one screen whose whole job is handing somebody a link.
    mintFails = 'too many codes made on this account — ask an admin'
    await act(async () => { makeButton().click() })
    expect(makeButton().disabled).toBe(false)
    expect(makeButton().textContent).toContain('Make an invite link')
    expect(text()).not.toContain('NEWCODE000000001')
  })
})

describe('what the sheet no longer says', () => {
  it('never tells a coach to go and ask an admin', async () => {
    // The card this replaced appeared whenever INVITE_ONLY was off and said a code "will not put
    // anyone on your roster". The server no longer works that way — a supplied code is honoured
    // either way — so the card would now be a lie, not merely unhelpful.
    inviteState = { invites: [], inviteOnly: false, max: 20 }
    await mount()
    expect(text()).not.toMatch(/ask an admin/i)
    expect(text()).not.toMatch(/invite-only/i)
    expect(text()).toContain('Send them a link')
  })

  it('mentions the quota only once it is actually in the way', async () => {
    inviteState = { invites: [], inviteOnly: false, max: 20 }
    await mount()
    expect(text()).not.toMatch(/links waiting/)

    act(() => root.unmount()); container.remove()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    inviteState = {
      invites: Array.from({ length: 2 }, (_, i) => ({ code: 'C' + i, note: '', created: '2026-09-11T00:00:00.000Z' })),
      inviteOnly: false, max: 2,
    }
    await mount()
    expect(text()).toMatch(/2 links waiting/)
    expect(makeButton().disabled).toBe(true)
  })

  it('says it could not load rather than showing an empty, permanently disabled form', async () => {
    // A { max: 0 } placeholder reads as a real answer everywhere downstream: 0 >= 0 disables the
    // button for ever under the words "You have 0 links waiting."
    listFails = true
    await mount()
    expect(text()).toContain('Could not load your invites')
    expect(text()).not.toMatch(/0 links waiting/)
  })
})

// R4 (Laravel): the plan's client cap. coach/invites says why nobody can be taken on right now
// (`reason`), and the sheet swaps its link form for the card that says so (design C22). The Node
// API sends no `reason`, which every test above already covers as "today's sheet".
describe('when the plan takes nobody on', () => {
  const waiting = [{ code: 'WAIT000000000001', note: 'Sara', created: '2026-09-11T00:00:00.000Z' }]
  const billingMe = (status, portal = true) => ({ entitlement: { status, canWrite: status !== 'paused' && status !== 'none' }, licence: null, plans: [], portal })

  it('at the cap: names the plan, offers the upgrade and the roster, and stops sharing links', async () => {
    useStore.setState({ billing: billingMe('active') })
    inviteState = { invites: waiting, max: 20, cap: 10, used: 10, canInvite: false, reason: 'at_cap' }
    await mount()
    expect(text()).toContain('Your plan allows 10 clients')
    expect(text()).toContain('You have 10 active clients')
    expect(text()).toContain('Upgrade')
    expect(text()).toContain('Manage clients')
    expect(makeButton()).toBe(undefined)
    // The waiting code stays listed and revocable, but is not handed out again.
    expect(text()).toContain('WAIT000000000001')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Share')).toBe(false)
    expect(container.querySelector('[aria-label="Revoke WAIT000000000001"]')).toBeTruthy()
    // Nor copied: the code is plain text, not the copy button.
    expect(container.querySelector('[aria-label="Copy the code WAIT000000000001"]')).toBe(null)
  })

  it('does not ask a blocked coach to make a link when nothing is waiting', async () => {
    useStore.setState({ billing: billingMe('paused') })
    inviteState = { invites: [], max: 20, cap: 30, used: 12, canInvite: false, reason: 'read_only' }
    await mount()
    expect(text()).toContain('Nothing waiting.')
    expect(text()).not.toContain('Make a link and send it')
  })

  it('reads a granted plan from the plan, not from a portal that has not loaded yet', async () => {
    // /billing/me not in yet: the ordinary copy, and no button until there is a portal to open.
    useStore.setState({ billing: null, config: null })
    inviteState = { invites: [], max: 20, cap: 10, used: 10, canInvite: false, reason: 'at_cap' }
    await mount()
    expect(text()).toContain('Upgrade to invite more')
    expect(text()).not.toContain('Ask FitPal')
  })

  it('at the cap on a granted plan: no upgrade button, there is no portal to upgrade in', async () => {
    useStore.setState({ billing: billingMe('manual', false) })
    inviteState = { invites: [], max: 20, cap: 10, used: 10, canInvite: false, reason: 'at_cap' }
    await mount()
    expect(text()).toContain('Ask FitPal for a larger plan')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Upgrade')).toBe(false)
  })

  it('paused: says inviting is paused and sends the coach to update the payment', async () => {
    useStore.setState({ billing: billingMe('paused') })
    inviteState = { invites: [], max: 20, cap: 30, used: 12, canInvite: false, reason: 'read_only' }
    await mount()
    expect(text()).toContain('Inviting is paused')
    expect(text()).toContain('Update payment')
    expect(makeButton()).toBe(undefined)
  })

  it('no plan yet: the same card, offering a plan instead', async () => {
    useStore.setState({ billing: billingMe('none', false) })
    inviteState = { invites: [], max: 20, cap: 0, used: 0, canInvite: false, reason: 'read_only' }
    await mount()
    expect(text()).toContain('Inviting is paused')
    expect(text()).toContain('Choose a plan')
    expect(text()).not.toContain('Update payment')
  })

  it('with a seat free: the ordinary form', async () => {
    inviteState = { invites: waiting, max: 20, cap: 30, used: 12, canInvite: true, reason: null }
    await mount()
    expect(makeButton()).toBeTruthy()
    expect(text()).not.toContain('Inviting is paused')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Share')).toBe(true)
  })
})
