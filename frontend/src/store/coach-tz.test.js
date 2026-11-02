// @vitest-environment happy-dom
//
// A coach's own clock (S.tz), stamped wherever a session starts: the server sends their morning
// summary at 07:00 where they are (backend fitpal:coach-digest), and a coach who never set a
// reminder had no zone it could read.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('../lib/api.js', () => ({ api: (...a) => apiMock(...a),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
  setRemoteAuth: () => {}, passkeyLogin: async () => ({ id: 'c1', name: 'Yasmine', coach: true }),
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
  initReminderSync: () => {}, writeAutoBackup: () => {},
}))
let zone = 'Europe/Madrid'
vi.mock('../lib/format.js', async orig => ({ ...(await orig()), localTZ: () => zone }))

const { useStore, DEF } = await import('./useStore.js')

const COACH = { id: 'c1', name: 'Yasmine', coach: true }

const serve = user => apiMock.mockImplementation(async path => {
  if (path === '/api/me') return { user }
  if (path === '/api/data') return { state: null }
  return {}
})
const bootAs = async (user, S = structuredClone(DEF)) => {
  useStore.setState({ S, user: null, config: null })
  serve(user)
  await useStore.getState().boot()
}

beforeEach(() => {
  // The stamp is an edit, and an edit arms the debounced push: kept on a fake clock, and dropped
  // after each test, so it never fires into the next one.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  apiMock.mockReset()
  window.localStorage.clear()
  zone = 'Europe/Madrid'
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the coach’s timezone', () => {
  it('is recorded for a coach on load, and again when they travel', async () => {
    await bootAs(COACH)
    expect(useStore.getState().S.tz).toBe('Europe/Madrid')
    await bootAs(COACH, { ...structuredClone(DEF), tz: 'Africa/Casablanca' })
    expect(useStore.getState().S.tz).toBe('Europe/Madrid')
  })

  it('is recorded on a fresh sign-in, not only on the next load', async () => {
    useStore.setState({ S: structuredClone(DEF), user: null })
    serve(COACH)
    await useStore.getState().passkeySignIn()
    expect(useStore.getState().S.tz).toBe('Europe/Madrid')
  })

  it('is not written into a client’s state', async () => {
    await bootAs({ id: 'm1', name: 'Alex', coachName: 'Yasmine' })
    expect(useStore.getState().S.tz).toBeUndefined()
  })

  it('is not UTC, which is no place: a hardened browser’s, or Intl failing', async () => {
    zone = 'UTC'
    await bootAs(COACH, { ...structuredClone(DEF), tz: 'Africa/Casablanca' })
    expect(useStore.getState().S.tz).toBe('Africa/Casablanca')
    zone = 'Etc/UTC'
    await bootAs(COACH)
    expect(useStore.getState().S.tz).toBeUndefined()
  })
})
