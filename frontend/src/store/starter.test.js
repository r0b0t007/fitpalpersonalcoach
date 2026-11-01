// @vitest-environment happy-dom
//
// A coach's starter program (CHW-338): an `auto` offer is taken in by the app itself — merged,
// workout 1 put on today, then accepted — once, however often the inbox is loaded, and it never
// shows as an offer to answer. Any other offer is left for the client, as before.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('../lib/api.js', () => ({ api: (...a) => apiMock(...a),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
  initReminderSync: () => {}, writeAutoBackup: () => {},
}))

const { useStore, DEF } = await import('./useStore.js')
const { todayISO } = await import('../lib/format.js')
const { effectiveRoutineIds } = await import('../lib/history.js')

const bundle = { opengym_plan: 1, name: 'Starter', week: {}, customEx: [],
  routines: [{ id: 'r1', name: 'Full body', ex: [{ id: '0025', sets: 3, reps: 8 }] }] }
const starter = { id: 'auto1', coachName: 'Yasmine', note: '', created: '2026-11-01T10:00:00.000Z', schedule: true, auto: true, bundle }
const offer = { ...starter, id: 'plain1', auto: false, bundle: { ...bundle, name: 'Block B' } }

let decideFails = false
beforeEach(() => {
  decideFails = false
  apiMock.mockReset()
  apiMock.mockImplementation(async (path, opts) => {
    if (path === '/api/assignments') return { assignments: [starter, offer] }
    if (path === '/api/assignments/decide') { if (decideFails) throw new Error('offline'); return { ok: true, status: 'accepted' } }
    return {}
  })
  window.localStorage.clear()
  useStore.setState({ S: structuredClone(DEF), user: { id: 'mem1', name: 'Salma', coachName: 'Yasmine' }, assignments: [] })
})

const decides = () => apiMock.mock.calls.filter(([p]) => p === '/api/assignments/decide').map(([, o]) => JSON.parse(o.body))

describe('a starter program', () => {
  it('is taken in and accepted by the app, with workout 1 today, and only the other offer is shown', async () => {
    await useStore.getState().loadAssignments()
    const S = useStore.getState().S
    expect(S.routines.map(r => r.name)).toEqual(['Full body'])
    expect(effectiveRoutineIds(S, todayISO())).toEqual([S.routines[0].id])
    expect(decides()).toEqual([{ id: 'auto1', accept: true }])
    expect(useStore.getState().assignments.map(a => a.id)).toEqual(['plain1'])
  })

  it('is merged once, even when the accept fails and the offer comes back', async () => {
    decideFails = true
    await useStore.getState().loadAssignments()
    decideFails = false
    await useStore.getState().loadAssignments()
    expect(useStore.getState().S.routines).toHaveLength(1)
    expect(decides()).toHaveLength(2)   // asked again, without adding the routines again
  })

  it('stays an offer to answer when it cannot be read', async () => {
    apiMock.mockImplementation(async path => (path === '/api/assignments' ? { assignments: [{ ...starter, bundle: { nope: true } }] } : {}))
    await useStore.getState().loadAssignments()
    expect(useStore.getState().S.routines).toEqual([])
    expect(useStore.getState().assignments.map(a => a.id)).toEqual(['auto1'])
    expect(decides()).toEqual([])
  })
})
