// A coached client's app (CHW-333): today's workout, logging, progress and their coach, and
// nothing that undoes the coach's program. The power-user features are hidden, never deleted:
// a client with no coach, one released by their coach, and a coach on "Train myself" keep every
// one of them, and so does the coach's own authoring (ProgramEdit reuses RoutineEdit).
import { isCoach } from './role.js'

/** A client their coach programs: has a coach, and is not a coach themselves. */
export const isCoached = user => !!user?.coachName && !isCoach(user)

/**
 * What a coached client does not get, and why each would hurt. Export stays (their data is
 * theirs to take), as do the in-session exercise swap, their own charts, pairing (the way the
 * phone app signs in) and their equipment (a filter on exercises, not a load). The sheets that
 * change the plan check these themselves (sheets.jsx), so no new button can reopen one.
 */
export const COACHED_HIDES = Object.freeze({
  library: 'browsing the exercise catalogue to build routines',
  muscles: 'the muscle map, a planning tool',
  editPlan: 'editing, adding or combining routines and the week: the coach owns the program',
  dayOverride: 'moving a day: it breaks the plan and the adherence the coach reads',
  starterPlans: 'loading a starter plan over the coach\'s',
  planShare: 'sharing or importing plan files',
  importData: 'importing other apps\' history (FitNotes, Strong, Hevy, Apple Health)',
  backupImport: 'restoring a backup over the synced plan',
  reset: 'wiping the plan and history the coach follows',
  recovery: 'the recovery and muscle-balance panels: useful to the coach, noise to a beginner',
  effort: 'the effort panel, for the same reason',
})

/** Whether `user` gets `feature` (a key of COACHED_HIDES). Unknown features are never hidden. */
export const can = (user, feature) => !(isCoached(user) && Object.hasOwn(COACHED_HIDES, feature))
