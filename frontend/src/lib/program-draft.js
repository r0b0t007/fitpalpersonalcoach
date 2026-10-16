// The shape a program is edited in, and the rules for changing it.
//
// A saved program is a *bundle* — the same frozen thing that gets sent to a client (plan-share.js,
// validateAssignmentBundle in api/domain.mjs). A bundle is not an editable shape: it has been
// through cleanEx, it carries only the custom exercises its routines actually reference, and the
// server rebuilds it on every save. So the editor unpacks a program into a draft, changes the
// draft, and packs a fresh bundle each time it saves.
//
// Everything here is pure and copy-on-write, mirroring useStore's `update`: clone, mutate the
// clone, return it. The editor holds the result in useState, which is what makes React re-render
// and what makes "undo by not saving" mean something.
import { uid } from './format.js'
import { t } from './i18n-core.js'
import { DEFAULT_GLYPH } from './glyphs.js'
import { buildProgramBundle, WEEK_DAYS } from './plan-share.js'

export { WEEK_DAYS }

// The server refuses a bundle with no routines (`plan has no routines`), and it is right to: an
// empty program is a trap the coach only finds when they try to send it. So the last routine
// cannot be deleted, and a brand-new program starts with one rather than with nothing.
export const canRemoveRoutine = draft => (draft?.routines || []).length > 1

export const emptyRoutine = name => ({ id: uid(), name, emoji: DEFAULT_GLYPH, ex: [] })

// Default names are stored data a client will read, so they are made in the coach's language.
export const newProgramDraft = (name = t('New program')) => ({
  name, routines: [emptyRoutine(t('Day {0}', 1))], week: {}, customEx: [],
})

/** Unpack a library row into something editable. Deep-copied: editing must not touch the loaded row. */
export function draftFromProgram(program) {
  const b = (program && program.bundle) || {}
  const week = b.week && typeof b.week === 'object' && !Array.isArray(b.week) ? b.week : {}
  return {
    // The row's name wins over the bundle's, the same way cleanProgram resolves it server-side.
    name: (program && program.name) || b.name || '',
    routines: structuredClone(Array.isArray(b.routines) ? b.routines : []),
    week: structuredClone(week),
    customEx: structuredClone(Array.isArray(b.customEx) ? b.customEx : []),
    // Carried through untouched. This editor does not set per-program targets or a check-in day —
    // the send sheet asks for those per client — but a bundle that already has them must not lose
    // them just because someone renamed the program.
    ...(b.nutrition ? { nutrition: b.nutrition } : {}),
    ...(b.checkinDay != null ? { checkinDay: b.checkinDay } : {}),
  }
}

/**
 * Pack a draft back into a bundle.
 *
 * `pool` is every custom exercise the coach has (`S.customEx`): the builder keeps only the ones the
 * routines reference, so passing the whole set is both correct and how a custom exercise added to a
 * program after it was first saved gets its definition into the bundle. Without it the client
 * accepting the program would get an exercise id that resolves to nothing.
 *
 * buildProgramBundle rather than buildPlanBundle, passing the draft's own routine ids: it filters
 * the week down to days that point at routines the bundle actually contains. Nothing in this editor
 * can create a dangling day — removeRoutine cleans up after itself — but a program saved by an
 * older build can already carry one, and re-saving it must not pass that on. A day pointing at a
 * routine that is not there reads to the client as a training day that opens nothing.
 */
export function bundleOf(draft, pool) {
  const customEx = []
  const seen = new Set()
  for (const c of [...(draft.customEx || []), ...(pool || [])]) {
    if (c && c.id && !seen.has(c.id)) { seen.add(c.id); customEx.push(c) }
  }
  const bundle = buildProgramBundle(
    { routines: draft.routines, week: draft.week, customEx },
    draft.routines.map(r => r.id),
    draft.name)
  if (draft.nutrition) bundle.nutrition = draft.nutrition
  // `!= null`, not truthy: 0 is Sunday.
  if (draft.checkinDay != null) bundle.checkinDay = draft.checkinDay
  return bundle
}

const patch = (draft, fn) => { const next = structuredClone(draft); fn(next); return next }

export const patchDraft = patch

export const renameProgram = (draft, name) => patch(draft, d => { d.name = name })

export function patchRoutine(draft, id, fn) {
  return patch(draft, d => { const r = d.routines.find(x => x.id === id); if (r) fn(r) })
}

export function addRoutine(draft, routine) {
  // A default name that counts routines rather than reusing "New routine" — three of those in a
  // list is the coach's problem to fix, and it is trivially avoidable here.
  const r = routine || emptyRoutine(t('Day {0}', (draft.routines || []).length + 1))
  return { next: patch(draft, d => { d.routines.push(r) }), routine: r }
}

export function removeRoutine(draft, id) {
  if (!canRemoveRoutine(draft)) return draft
  return patch(draft, d => {
    d.routines = d.routines.filter(r => r.id !== id)
    // A weekday holds a routine-id list: pull the removed id from each day and drop the key when
    // it empties. Leaving `[]` behind would schedule a day onto nothing, which reads to the client
    // as a training day with no session.
    for (const k of Object.keys(d.week)) {
      const kept = [].concat(d.week[k]).filter(rid => rid !== id)
      if (kept.length) d.week[k] = kept; else delete d.week[k]
    }
  })
}

/** Put a routine on a weekday, or take it off. A day can hold several, in the order they were added. */
export function toggleDay(draft, day, routineId) {
  return patch(draft, d => {
    const on = [].concat(d.week[day] || [])
    const at = on.indexOf(routineId)
    const kept = at >= 0 ? on.filter(x => x !== routineId) : on.concat(routineId)
    if (kept.length) d.week[day] = kept; else delete d.week[day]
  })
}

/** How many days of the week have anything on them — the "3 days/wk" tag in the library. */
export const scheduledDays = draft =>
  WEEK_DAYS.filter(d => [].concat(draft.week?.[d] || []).length).length
