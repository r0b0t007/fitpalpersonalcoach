// The coach's own exercise demos, as the client holds them.
//
// WHY THIS IS NOT IN THE ZUSTAND STORE. These rows are server state: db.media belongs to the
// API, the client only reads it. Parking them in useStore's `S` would put them inside the blob
// that is persisted to localStorage and debounce-pushed back with PUT /api/data — a route that
// replaces state-<uid>.json wholesale. The client would then be echoing the server's own table
// back at it on every sync, and a stale tab would overwrite it. `S` is for what the user owns.
//
// useUI is the other candidate and is wrong for a different reason: lib/exercises.js has to
// answer "does this exercise have a demo, and at what URL" SYNCHRONOUSLY, from a plain function,
// with no hook — and without importing React at all, because a node build script imports that
// module (scripts/build-hevy-id-map.mjs). A Zustand store cannot be read from there without
// dragging the store into every consumer.
//
// So: a module-level registry with an explicit subscribe. That is precisely the shape
// useSyncExternalStore exists for, and components/Media.jsx uses it to re-render the one time
// the list lands. One fetch per sign-in (App.jsx), one snapshot, every read after that is free.
//
// The fetch itself is NOT here — lib/api.js is the only place that talks to the backend, so the
// caller passes the rows in. This module stays import-free and therefore node-loadable.

// Frozen and shared so an exercise with no demo always yields the SAME empty array. A fresh []
// per call would give every Media a new dependency identity on every render.
const NONE = Object.freeze([])

let INDEX = {}    // exId -> rows, newest first
let VERSION = 0   // bumped whenever INDEX is replaced; the useSyncExternalStore snapshot
const subs = new Set()

export const isVideoRow = m => typeof m?.mime === 'string' && m.mime.startsWith('video/')
export const isPhotoRow = m => typeof m?.mime === 'string' && m.mime.startsWith('image/')

// Pure. Rows with nothing to address them by are dropped rather than turned into a URL that
// 404s — db.json is a plain file an operator can hand-edit, and GET /api/media/ex says the same
// thing about the same data from the other side.
export function indexMedia(rows) {
  const list = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.media) ? rows.media : [])
  const out = {}
  for (const m of list) {
    if (!m || typeof m.id !== 'string' || !m.id) continue
    if (typeof m.exId !== 'string' || !m.exId) continue
    ;(out[m.exId] = out[m.exId] || []).push(m)
  }
  // Newest first: when a coach has re-shot a demo, "the" demo is the one they shot last, and
  // the old take stays reachable in the upload manager rather than being what everyone sees.
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
  return out
}

export function setCoachMedia(rows) {
  INDEX = indexMedia(rows)
  VERSION++
  for (const fn of subs) fn()
}

export const coachMediaFor = exId => (exId && INDEX[exId]) || NONE
export const allCoachMedia = () => Object.keys(INDEX).flatMap(k => INDEX[k])
export const coachMediaVersion = () => VERSION
export function subscribeCoachMedia(fn) { subs.add(fn); return () => { subs.delete(fn) } }
