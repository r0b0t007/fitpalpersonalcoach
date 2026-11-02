// @vitest-environment happy-dom
//
// A coach's own clock (S.tz), stamped on every load: the server sends their morning summary at
// 07:00 where they are (backend fitpal:coach-digest), and a coach who never set a reminder had no
// zone it could read.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('../lib/api.js', () => ({ api: (...a) => apiMock(...a),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
  initReminderSync: () => {}, writeAutoBackup: () => {},
}))
vi.mock('../lib/format.js', async orig => ({ ...(await orig()), localTZ: () => 'Europe/Madrid' }))

const { useStore, DEF } = await import('./useStore.js')

const bootAs = async (user, S = structuredClone(DEF)) => {
  useStore.setState({ S, user: null, config: null })
  apiMock.mockImplementation(async path => {
    if (path === '/api/me') return { user }
    if (path === '/api/data') return { state: null }
    if (path === '/api/config') return {}
    return {}
  })
  await useStore.getState().boot()
}

beforeEach(() => {
  apiMock.mockReset()
  window.localStorage.clear()
})

describe('the coach’s timezone', () => {
  it('is recorded for a coach on load, and again when they travel', async () => {
    await bootAs({ id: 'c1', name: 'Yasmine', coach: true })
    expect(useStore.getState().S.tz).toBe('Europe/Madrid')
    await bootAs({ id: 'c1', name: 'Yasmine', coach: true }, { ...structuredClone(DEF), tz: 'Africa/Casablanca' })
    expect(useStore.getState().S.tz).toBe('Europe/Madrid')
  })

  it('is not written into a client’s state', async () => {
    await bootAs({ id: 'm1', name: 'Alex', coachName: 'Yasmine' })
    expect(useStore.getState().S.tz).toBeUndefined()
  })
})
