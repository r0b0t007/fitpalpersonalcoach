// @vitest-environment happy-dom
//
// A client deleting their own account (CHW-363): one warning, then the delete — and, for a session
// that signed in a while ago, a code to their own address first.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let DELETE = []   // what each deleteAccount() call does, in turn
let ACCOUNT = null
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  deleteAccount: async () => { calls.push('delete'); const next = DELETE.shift(); if (next) throw next; return { ok: true } },
  fetchAccount: async () => { calls.push('account'); return ACCOUNT },
  requestLoginLink: async email => { calls.push('mail ' + email); return { ok: true } },
  signInWithCode: async (email, code) => { calls.push(`code ${email} ${code}`); return { user: { id: 'u1' } } },
}))
const { DeleteAccountSheet } = await import('./DeleteAccountSheet.jsx')
const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')

const refusal = (error, message = error) => Object.assign(new Error(message), { status: 403, error })
let container, root, closed, deleted, toasts, forgot
const text = () => container.textContent
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent === label)
const click = async el => { await act(async () => { el.click() }) }
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; DELETE = []; ACCOUNT = { email: 'salma@example.com', verified: true }; closed = 0; deleted = 0; toasts = []; forgot = 0
  vi.spyOn(useUI.getState(), 'toast').mockImplementation(m => { toasts.push(m) })
  useStore.setState({ forgetLocalSession: () => { forgot++ } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => { root.render(<DeleteAccountSheet close={() => { closed++ }} onDeleted={() => { deleted++ }} />) })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

describe('deleting your account', () => {
  it('says what goes and points at the export before anything is deleted', async () => {
    expect(text()).toContain('Delete your account?')
    expect(text()).toContain('export a backup first')
    expect(calls).toEqual([])
  })

  it('deletes at once for a session that signed in just now, then forgets this device', async () => {
    await click(button('Delete my account'))
    expect(calls).toEqual(['delete'])
    expect([closed, forgot, deleted]).toEqual([1, 1, 1])
    expect(toasts).toEqual(['Your account is deleted'])
  })

  it('sends a code to their own address when the sign-in is old, and deletes once it is typed', async () => {
    DELETE = [refusal('sign in again to do this — it needs a recent sign-in')]
    await click(button('Delete my account'))
    expect(calls).toEqual(['delete', 'account', 'mail salma@example.com'])
    expect(text()).toContain('Enter the 6-digit code we sent to salma@example.com.')
    expect(forgot).toBe(0)

    await type(container.querySelector('input[name="code"]'), '482 913')
    await click(button('Delete my account'))
    expect(calls.slice(3)).toEqual(['code salma@example.com 482913', 'delete'])
    expect([closed, forgot, deleted]).toEqual([1, 1, 1])
  })

  it('spends the code once, however fast Enter is pressed twice', async () => {
    DELETE = [refusal('sign in again to do this — it needs a recent sign-in')]
    await click(button('Delete my account'))
    const field = container.querySelector('input[name="code"]')
    await type(field, '482913')
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(calls.filter(c => c.startsWith('code '))).toEqual(['code salma@example.com 482913'])
  })

  it('can send the code again, or be left, from the code step', async () => {
    DELETE = [refusal('sign in again to do this — it needs a recent sign-in')]
    await click(button('Delete my account'))
    await click(button('Send the code again'))
    expect(calls).toEqual(['delete', 'account', 'mail salma@example.com', 'mail salma@example.com'])
    await click(button('Cancel'))
    expect([closed, forgot, deleted]).toEqual([1, 0, 0])
  })

  it('mails no code to an address the account has not confirmed: it says to sign in again', async () => {
    ACCOUNT = { email: 'salma@example.com', verified: false }
    DELETE = [refusal('sign in again to do this — it needs a recent sign-in')]
    await click(button('Delete my account'))
    expect(calls).toEqual(['delete', 'account'])
    expect(toasts).toEqual(['sign in again to do this — it needs a recent sign-in'])
    expect(text()).toContain('Delete your account?')
  })

  it('shows any other refusal and deletes nothing', async () => {
    DELETE = [refusal('a coach account is closed on request — write to us')]
    await click(button('Delete my account'))
    expect(calls).toEqual(['delete'])
    expect(toasts).toEqual(['a coach account is closed on request — write to us'])
    expect([closed, forgot, deleted]).toEqual([0, 0, 0])
  })
})
