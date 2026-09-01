// @vitest-environment happy-dom
//
// The invariant the whole coach feature is built around.
//
// Sync here is whole-state replacement, not merge: pushState PUTs all of S, and pullState only
// adopts the server's copy when its _ts is newer AND this device has nothing unsynced. That is
// exactly why a coach's program is NOT written into state-<uid>.json server-side — a member
// holding any unsynced change would push over it and the program would vanish with no error
// anywhere. Instead the offer lives in db.json and the member's own device does the merge.
//
// These lock that reasoning down. If someone later "optimises" delivery by having the server
// write member state, the last test here is the one that should stop them.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('../lib/api.js', () => ({ api: (...a) => apiMock(...a) }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {}
}))

const { useStore, DEF } = await import('./useStore.js')

const routine = (id, name) => ({ id, name, emoji: 'barbell', ex: [{ id: '0025', sets: 3, reps: 8 }] })
const stateWith = (routines, ts) => ({ ...structuredClone(DEF), routines, _ts: ts })

beforeEach(() => {
  apiMock.mockReset()
  window.localStorage.clear()
  useStore.setState({ S: structuredClone(DEF), user: { id: 'mem1', name: 'Alex' }, assignments: [] })
})

describe('a coach’s program survives the sync model', () => {
  it('a device with unsynced changes pushes them up rather than adopting an older server copy', async () => {
    // The member just accepted a program: mergePlan added it locally and persist() stamped a
    // fresh _ts. The server still holds the copy from before.
    useStore.setState({ S: stateWith([routine('own', 'Mine'), routine('coach', 'Block A')], 9_000) })
    window.localStorage.setItem('gym_dirty', '1')
    apiMock.mockImplementation(async (path) => {
      if (path === '/api/data') return { state: stateWith([routine('own', 'Mine')], 1_000) }
      return {}
    })

    await useStore.getState().pullState()

    // The accepted program is still here, and the stale server copy did not win.
    const names = useStore.getState().S.routines.map(r => r.name)
    expect(names).toContain('Block A')
    expect(names).toContain('Mine')
    // ...and the local copy was pushed up, which is how the server learns about it at all.
    expect(apiMock).toHaveBeenCalledWith('/api/data', expect.objectContaining({ method: 'PUT' }))
  })

  it('still refuses an older server copy even when this device is clean', async () => {
    useStore.setState({ S: stateWith([routine('coach', 'Block A')], 9_000) })
    apiMock.mockImplementation(async (path) => {
      if (path === '/api/data') return { state: stateWith([], 1_000) }
      return {}
    })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Block A'])
  })

  it('adopts the server copy when it is genuinely newer and nothing local is unsynced', async () => {
    // The ordinary case — accepted on another device, arriving here.
    useStore.setState({ S: stateWith([routine('own', 'Mine')], 1_000) })
    apiMock.mockImplementation(async (path) => {
      if (path === '/api/data') return { state: stateWith([routine('own', 'Mine'), routine('coach', 'Block A')], 9_000) }
      return {}
    })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Mine', 'Block A'])
  })

  it('a newer server copy does NOT win while this device has unsynced work', async () => {
    // This is the case that makes server-side delivery unsafe. Even with a newer _ts, a dirty
    // device pushes its own state up — so anything the server wrote into member state on its own
    // would be silently destroyed here. The offer therefore never lives in member state.
    useStore.setState({ S: stateWith([routine('own', 'Mine')], 1_000) })
    window.localStorage.setItem('gym_dirty', '1')
    apiMock.mockImplementation(async (path) => {
      if (path === '/api/data') return { state: stateWith([routine('srv', 'Written by the server')], 9_000) }
      return {}
    })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Mine'])
    expect(apiMock).toHaveBeenCalledWith('/api/data', expect.objectContaining({ method: 'PUT' }))
  })
})

describe('pending offers are session state, not member data', () => {
  it('are dropped on sign-out so a shared device never shows the last profile’s offer', () => {
    useStore.setState({ assignments: [{ id: 'a1', coachName: 'Sam' }] })
    useStore.getState().setUser(null)
    expect(useStore.getState().assignments).toEqual([])
  })

  it('are never written into the persisted plan', async () => {
    useStore.setState({ assignments: [{ id: 'a1', coachName: 'Sam' }] })
    useStore.getState().update(s => { s.routines.push(routine('r1', 'Something')) }, false)
    const saved = JSON.parse(window.localStorage.getItem('gym_state_v1'))
    expect(saved.assignments).toBeUndefined()
  })
})
