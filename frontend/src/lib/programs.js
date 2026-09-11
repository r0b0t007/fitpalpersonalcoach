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

export const saveClientNote = (memberId, text) =>
  api('/api/coach/notes/save', { method: 'POST', body: JSON.stringify({ memberId, text }) })

/**
 * Move a pre-server library up, once.
 *
 * Deliberately additive and id-preserving: a program already on the server wins, so running this
 * twice — two devices, or a coach who upgrades, syncs, then opens the dashboard again — cannot
 * duplicate anything. The caller clears `S.programs` only after every row is safely up, and the
 * DEF key stays in the store for a release so an older device pulling its own state does not
 * resurrect a library that has already moved.
 *
 * Returns what happened so the caller can say it out loud rather than migrating in silence.
 */
export async function migrateLocalPrograms(local, remote) {
  const have = new Set((remote || []).map(p => p && p.id))
  const todo = (local || []).filter(p => p && p.id && p.bundle && !have.has(p.id))
  if (!todo.length) return { moved: 0, failed: [], programs: remote || [] }

  let programs = remote || []
  const failed = []
  for (const p of todo) {
    try {
      const r = await savePrograms({ id: p.id, name: p.name, bundle: p.bundle })
      programs = r.programs || programs
    } catch (e) {
      // One bad row — a bundle that predates a validation rule — must not strand the rest.
      failed.push({ name: p.name, error: e.message })
    }
  }
  return { moved: todo.length - failed.length, failed, programs }
}
