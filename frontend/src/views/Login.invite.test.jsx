// @vitest-environment happy-dom
//
// Arriving from a coach's invite link. Normally the sign-up sheet opens by itself; when the
// coach's plan has no seat left (GET /api/invite `full`, Laravel only) registration would be
// refused AFTER the passkey prompt, so the screen says so instead — and opens nothing.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let INVITE = null
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

let container, root
const text = () => container.textContent

// Fresh modules per test: the invite link and the server's answer are both read once and cached.
async function mountLogin(answer) {
  vi.resetModules()
  INVITE = answer
  vi.doMock('../lib/api.js', async orig => ({
    ...(await orig()),
    api: async path => {
      if (path.startsWith('/api/invite?')) return INVITE
      throw new Error('unexpected ' + path)
    },
    webauthnOK: () => true,
  }))
  const { useStore } = await import('../store/useStore.js')
  const { useUI } = await import('../store/useUI.js')
  const { default: Login } = await import('./Login.jsx')
  useStore.setState({ config: { invite_only: true, allow_guest: false } })
  await act(async () => { root.render(<Login />) })
  await act(async () => {})
  return useUI
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  history.replaceState(null, '', '/?invite=ABCD000000000001')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); history.replaceState(null, '', '/') })

describe('arriving from an invite link', () => {
  it('opens the sign-up when the coach has room', async () => {
    const useUI = await mountLogin({ coachName: 'Ahmed', full: false })
    expect(text()).toContain('Ahmed invited you to train with them.')
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('says the list is full, and opens nothing, when it is', async () => {
    const useUI = await mountLogin({ coachName: 'Ahmed', full: true })
    expect(text()).toContain('Ahmed’s client list is full right now')
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('opens the sign-up as before on the Node API, which sends no `full`', async () => {
    const useUI = await mountLogin({ coachName: 'Ahmed' })
    expect(text()).not.toContain('client list is full')
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('never offers the removed request-access form', async () => {
    await mountLogin(null)
    expect(text()).not.toMatch(/Request access/i)
  })
})
