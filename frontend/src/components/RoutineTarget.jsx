import { createContext, useContext, useEffect } from 'react'
import { useStore } from '../store/useStore.js'

/**
 * Who owns the routine the editor is editing.
 *
 * `views/RoutineEdit.jsx` used to reach into the store nine times — `S.routines.find(x => x.id ===
 * id)` to read, and eight `update(s => s.routines.find(...))` calls to write. That is a fine
 * binding for the one screen it was written for and the reason a coach could not edit a program:
 * a program's routines live in a draft on the way to the server, not in the coach's own plan.
 *
 * So the editor no longer knows where its routine lives. It asks for a target and gets:
 *
 *   routine       the routine to edit, or null when the id resolves to nothing
 *   patch(fn)     mutate it — fn receives the routine, the owner decides what persisting means
 *   siblings      the routines it sits among (a copy joins them; the last one cannot be deleted)
 *   addCopy(r)    add a sibling
 *   remove()      delete this routine AND whatever else refers to it
 *   canRemove     false when removing would leave a set the owner cannot save
 *   pathFor(id)   where a sibling lives
 *   backPath      where the header's back button goes
 *   backLabel     what that button is called; already final, so a coach surface stays English
 *   ownEquipment  true when this is the viewer's own plan, so "you don't own this kit" applies
 *
 * Two providers implement it: the one below, which reproduces exactly what the screen did before,
 * and the draft in `views/coach/ProgramEdit.jsx`.
 */
const Ctx = createContext(null)

export function useRoutineTarget() {
  const target = useContext(Ctx)
  // Not a soft fallback: an editor with no target would render a blank screen and swallow every
  // edit, which is the failure that takes a day to notice.
  if (!target) throw new Error('RoutineEdit needs a RoutineTarget provider above it')
  return target
}

export const RoutineTarget = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>

/** The coach's — or client's — own plan, in the store. Every field change persists on the spot. */
export function StoreRoutineTarget({ id, children }) {
  const routines = useStore(s => s.S.routines)
  const update = useStore(s => s.update)
  // Editing here has no explicit "save". A single auto-backup on the way out (not per keystroke)
  // covers the whole editing session, deletion included: this still unmounts after the delete
  // button navigates away.
  useEffect(() => () => useStore.getState().autoBackupNow(), [])

  const value = {
    routine: (routines || []).find(x => x.id === id) || null,
    siblings: routines || [],
    ownEquipment: true,
    canRemove: true,
    backPath: '/plan',
    backLabel: null,      // the client's own plan: the screen's translated t('Plan') is right
    pathFor: rid => '/plan/r/' + rid,
    // The find is repeated inside the producer rather than closing over the routine above: the
    // producer runs against a fresh clone of S, and mutating the rendered object would write into
    // a draft nobody persists.
    patch: fn => update(s => { const target = s.routines.find(x => x.id === id); if (target) fn(target) }),
    addCopy: copy => update(s => { s.routines.push(copy) }),
    remove: () => update(s => {
      s.routines = s.routines.filter(x => x.id !== id)
      // A weekday holds a routine-id list: pull the deleted id from each day, drop the key when
      // it empties (never store []). dayPlan stays scalar.
      Object.keys(s.week).forEach(k => {
        const next = [].concat(s.week[k]).filter(rid => rid !== id)
        if (next.length) s.week[k] = next; else delete s.week[k]
      })
      Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
    }),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
