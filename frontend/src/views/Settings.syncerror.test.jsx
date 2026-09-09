// @vitest-environment happy-dom
// The server refusing a save is only a fix if someone can see it. PUT /api/data answers an
// over-size state with a sentence naming the limit and what to do about it; pushState keeps it in
// `syncError`, and this is the screen that has to show it — otherwise the profile still stops
// syncing forever with nothing on screen, which was the whole bug.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, syncError: null }
  state.snapshot = () => ({
    S: state.S, user: state.user, syncError: state.syncError, coachLocal: null,
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {},
  useLocation: () => ({ key: 'test', pathname: '/settings' }),
}))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
  IS_IOS: false, IS_APPLE: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn(),
  initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {},
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const REFUSAL = 'your training data is over the 16 MB limit for one sync, so this device could not save to the server.'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'Sam' }
  mocks.syncError = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings />))

describe('Settings — a save the server refused', () => {
  it('shows the server’s own sentence, not a generic failure', () => {
    mocks.syncError = REFUSAL
    mount()
    expect(host.textContent).toContain('This device could not save to the server')
    expect(host.textContent).toContain(REFUSAL)
  })

  it('shows nothing while syncing is fine', () => {
    mount()
    expect(host.textContent).not.toContain('This device could not save to the server')
  })
})
