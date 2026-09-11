// The coach's program library, which lives on the server (api/server.js, coach-<uid>.json).
//
// It used to live in the coach's own `S` under `programs`, and that was wrong in four ways: every
// state push carried every bundle, a coach who never trains had no state to keep them in, the
// server could not read them, and "Train myself" dragged the whole library into the trainee view.
// This module is the client half — plain fetches through api(), plus the one-time migration that
// lifts an old local library up to the server.
import { api } from './api.js'

export const fetchPrograms = () => api('/api/coach/programs').then(d => ({ programs: d.programs || [], max: d.max }))

export const savePrograms = ({ id, name, bundle }) =>
  api('/api/coach/programs/save', { method: 'POST', body: JSON.stringify({ id, name, bundle }) })

export const deleteProgram = id =>
  api('/api/coach/programs/delete', { method: 'POST', body: JSON.stringify({ id }) })

/**
 * Move a pre-server library up, once.
 *
 * Additive and id-preserving: a program already on the server wins, so running this twice — two
 * devices, or a coach who upgrades, syncs, then opens the dashboard again — cannot duplicate
 * anything.
 *
 * `safeIds` is the contract with the caller and the reason this returns anything at all: it holds
 * exactly the ids that are now on the server, so the caller removes those and NOTHING else from
 * the local copy. A row the server refused (over the cap, a bundle that predates a validation
 * rule) and a row too damaged to send (no id, no bundle) both stay local, where the coach can
 * still see them. An earlier version cleared the whole local library whenever anything moved,
 * which quietly destroyed every rejected program — the one copy of it.
 */
export async function migrateLocalPrograms(local, remote) {
  const list = local || []
  const have = new Set((remote || []).map(p => p && p.id).filter(Boolean))
  const todo = list.filter(p => p && p.id && p.bundle && !have.has(p.id))
  // Already-uploaded rows are safe whether or not there is anything left to do.
  const safeIds = new Set(list.filter(p => p && p.id && have.has(p.id)).map(p => p.id))
  if (!todo.length) return { moved: 0, failed: [], programs: remote || [], safeIds }

  let programs = remote || []
  const failed = []
  for (const p of todo) {
    try {
      const r = await savePrograms({ id: p.id, name: p.name, bundle: p.bundle })
      programs = r.programs || programs
      safeIds.add(p.id)
    } catch (e) {
      // One bad row — a bundle that predates a validation rule, or the library cap — must not
      // strand the rest, and must not be thrown away either.
      failed.push({ name: p.name, error: e.message })
    }
  }
  return { moved: todo.length - failed.length, failed, programs, safeIds }
}
