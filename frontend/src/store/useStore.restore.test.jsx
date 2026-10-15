// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))

import { api } from '../lib/api.js'
import { DEF, restoredStateFor, useStore } from './useStore.js'

// Only the state endpoint. pullState() also refreshes the coach-offer inbox (/api/assignments),
// so counting every api() call would make these tests hostage to unrelated sync traffic.
const dataCalls = () => api.mock.calls.filter(([path]) => path === '/api/data')

const clone = value => JSON.parse(JSON.stringify(value))
const routine = id => ({ id, name: id, ex: [] })

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false, syncError: null })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, syncError: null })
})

describe('saved workout state sync and restore', () => {
  it('returns null for an older or dirty local state', () => {
    const local = { ...clone(DEF), _ts: 20, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 10, routines: [routine('remote')] }

    expect(restoredStateFor(local, remote)).toBeNull()
    expect(restoredStateFor(local, { ...remote, _ts: 30 }, true)).toBeNull()
  })

  it('overlays defaults and carries the device-local active workout', () => {
    const active = { id: 'active-1', routineId: 'local', entries: [] }
    const local = { ...clone(DEF), active }
    const restored = restoredStateFor(local, { _ts: 20, routines: [routine('remote')] })

    expect(restored.routines.map(r => r.id)).toEqual(['remote'])
    expect(restored.active).toEqual(active)
    expect(restored.restSec).toBe(90)
  })

  it('adopts a newer clean remote state while preserving a local active workout', async () => {
    const active = { id: 'active-1', d: '2026-08-29', routineId: 'local', name: 'Local', entries: [] }
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')], active }
    const remote = { ...clone(DEF), _ts: 20, routines: [routine('remote')], active: null }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValue({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['remote'])
    expect(useStore.getState().S.active).toEqual(active)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active).toEqual(active)
    expect(dataCalls()).toHaveLength(1)
  })

  it('pushes local data instead of replacing it when the local state is newer', async () => {
    const local = { ...clone(DEF), _ts: 20, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 10, routines: [routine('remote')] }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: remote }).mockResolvedValueOnce({})

    await useStore.getState().pullState()

    expect(dataCalls()).toHaveLength(2)
    expect(JSON.parse(dataCalls()[1][1].body).state.routines.map(r => r.id)).toEqual(['local'])
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['local'])
  })

  it('pushes local data instead of overwriting a dirty local state', async () => {
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 20, routines: [routine('remote')] }
    localStorage.setItem('gym_dirty', '1')
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: remote }).mockResolvedValueOnce({})

    await useStore.getState().pullState()

    expect(dataCalls()).toHaveLength(2)
    expect(JSON.parse(dataCalls()[1][1].body).state.routines.map(r => r.id)).toEqual(['local'])
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['local'])
  })

  it('restores a remote state over defaults when the local profile is empty', async () => {
    const remote = { _ts: 30, routines: [routine('remote')], workouts: [] }
    api.mockResolvedValue({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['remote'])
    expect(useStore.getState().S.restSec).toBe(90)
    expect(useStore.getState().S.lang).toBe(DEF.lang)
  })

  // The three-key hasData() called a profile whose only data was food, tape or a check-in empty,
  // and an "empty" local state loses to the remote one outright — dirty flag and newer _ts both
  // skipped. A meal logged offline is exactly that profile: signed in, no routine, no weigh-in.
  it('keeps a local profile whose only data is logged meals', async () => {
    const meal = { id: 'm1', d: '2026-09-09', n: 'Eggs', g: 100, kcal: 155, p: 13, c: 1, f: 11, s: '', t: 99 }
    const local = { ...clone(DEF), _ts: 99, meals: [meal] }
    const remote = { ...clone(DEF), _ts: 1, meals: [] }
    localStorage.setItem('gym_dirty', '1')

    expect(restoredStateFor(local, remote, true)).toBeNull()

    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: remote }).mockResolvedValueOnce({})
    await useStore.getState().pullState()

    expect(useStore.getState().S.meals).toEqual([meal])
    expect(dataCalls()).toHaveLength(2)   // the compensating push, not a silent overwrite
  })

  it('counts rolled-up meal days and the other client-authored records as data', () => {
    const remote = { ...clone(DEF), _ts: 99, routines: [routine('remote')] }
    for (const only of [
      { mealDays: { '2026-01-04': [2000, 150, 200, 60] } },
      { measurements: [{ d: '2026-09-09', site: 'waist', v: 82, t: 1 }] },
      { checkins: [{ d: '2026-09-09', answers: { energy: 4 }, t: 1 }] },
      { foods: [{ id: 'f1', n: 'Rice', kcal: 130, p: 3, c: 28, f: 0 }] },
    ]) expect(restoredStateFor({ ...clone(DEF), _ts: 100, ...only }, remote)).toBeNull()
  })

  it('surfaces a refused save and clears it on the next good one', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: true })
    const refusal = Object.assign(new Error('your training data is over the 16 MB limit'), { status: 413 })
    api.mockRejectedValueOnce(refusal)

    await useStore.getState().pushState()

    expect(useStore.getState().syncError).toBe('your training data is over the 16 MB limit')
    expect(localStorage.getItem('gym_dirty')).toBe('1')

    api.mockResolvedValueOnce({})
    await useStore.getState().pushState()

    expect(useStore.getState().syncError).toBeNull()
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  // Offline is not a refusal. A failed push on a train must leave nothing on screen — the state
  // is fine, the dirty flag already covers the retry.
  it('leaves no error on screen when the push simply fails offline', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: true })
    api.mockRejectedValueOnce(new Error('Failed to fetch'))

    await useStore.getState().pushState()

    expect(useStore.getState().syncError).toBeNull()
    expect(localStorage.getItem('gym_dirty')).toBe('1')
  })

  it('keeps the local saved state when the restore request fails', async () => {
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')] }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockRejectedValue(new Error('offline'))

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['local'])
    expect(dataCalls()).toHaveLength(1)
  })
})
