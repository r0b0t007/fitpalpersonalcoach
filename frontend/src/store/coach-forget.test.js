// @vitest-environment happy-dom
//
// The AI Coach kept its conversation, proposal log, snapshots and consent record under `S.coach`.
// The feature is gone; the data is not, on any device that used it.
//
// Two reasons it has to be dropped rather than ignored. `S` is pushed WHOLE on every sync, so an
// inert ~75 KB blob would ride along for ever. And it is a transcript of somebody's conversation
// about their own training, which no surviving screen can show them or let them delete — keeping
// it would mean holding a log its subject cannot reach.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({
  api: async () => ({}), IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
  initReminderSync: () => {}, writeAutoBackup: () => {},
}))

const KEY = 'gym_state_v1'
const withCoach = {
  _ts: 1,
  routines: [{ id: 'r1', name: 'Push', ex: [] }],
  coach: {
    consent: { agreedAt: '2026-01-01', version: 1 },
    chat: [{ role: 'user', text: 'make me a plan' }, { role: 'coach', text: 'here is one' }],
    log: [{ id: 'p1', changes: [{ kind: 'weight' }] }],
    snapshots: [{ id: 's1' }],
  },
}

beforeEach(() => { localStorage.clear(); vi.resetModules() })

describe('state left behind by the AI Coach', () => {
  it('is dropped when a device loads its stored state', async () => {
    localStorage.setItem(KEY, JSON.stringify(withCoach))
    const { useStore } = await import('./useStore.js')
    const S = useStore.getState().S
    expect(S.coach).toBeUndefined()
    // Everything else survives — this is one key, not a reset.
    expect(S.routines).toHaveLength(1)
  })

  it('is scrubbed from what gets written back, so the server copy heals on the next push', async () => {
    localStorage.setItem(KEY, JSON.stringify(withCoach))
    const { useStore } = await import('./useStore.js')
    useStore.getState().update(s => { s.bodyweight.push({ d: '2026-09-12', w: 70 }) }, false)
    const written = JSON.parse(localStorage.getItem(KEY))
    expect(written.coach).toBeUndefined()
    expect(written.bodyweight).toHaveLength(1)
  })

  it('cannot be reintroduced by a state arriving from the server', async () => {
    // pullState adopts the remote copy through the same persist path. A server file written
    // before the removal still carries the blob.
    const { useStore } = await import('./useStore.js')
    useStore.getState().replaceState(withCoach, false)
    expect(useStore.getState().S.coach).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(KEY)).coach).toBeUndefined()
  })

  it('leaves keys it has never heard of alone', async () => {
    // Not a general unknown-key sweep: S belongs to the client, and an older build must be able
    // to hold a key a newer one introduced without a downgrade eating it.
    localStorage.setItem(KEY, JSON.stringify({ ...withCoach, somethingNewer: { keep: true } }))
    const { useStore } = await import('./useStore.js')
    expect(useStore.getState().S.somethingNewer).toEqual({ keep: true })
    expect(useStore.getState().S.coach).toBeUndefined()
  })
})
