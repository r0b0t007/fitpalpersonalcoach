// A coach's starter program (CHW-338): the offer a page's accept comes with, marked `auto`, which
// the client's app takes in by itself (store/useStore.js loadAssignments), so workout 1 is there
// the day they join instead of "{coach} is preparing your program". Pure: it decides what the
// client lifts first, so it has a test beside it (CONTRIBUTING).
import { mergePlan } from './plan-share.js'
import { effectiveRoutineIds } from './history.js'

/**
 * Merges a starter bundle (as parsePlan hands it over) into the state, then puts its first routine
 * with something in it on `today` when nothing is planned there: the program may start on a
 * Monday, and the person joined on a Wednesday. A day the client marked as rest stays rest.
 *
 * Nobody is asked, so nothing of theirs is replaced: the program's week is taken only when they
 * have none of their own, and targets or a check-in day they already have are kept. A brand-new
 * client has none of these; one who comes back to a coach after a release may have all three.
 * A mutator for update(); returns the routine id put on today, or null.
 */
export function applyStarter(s, bundle, today) {
  s.dayPlan = s.dayPlan || {}
  s.week = s.week || {}
  s.routines = s.routines || []
  const before = s.routines.length
  const ownWeek = Object.values(s.week).some(ids => [].concat(ids || []).length)
  const kept = { nutriTarget: s.nutriTarget, checkinDay: s.checkinDay }
  mergePlan(s, bundle, { schedule: !ownWeek })
  if (kept.nutriTarget) s.nutriTarget = kept.nutriTarget
  if (kept.checkinDay != null) s.checkinDay = kept.checkinDay
  if (s.dayPlan[today] === 'rest' || effectiveRoutineIds(s, today).length) return null
  const first = s.routines.slice(before).find(r => (r.ex || []).length)
  if (!first) return null
  s.dayPlan[today] = first.id
  return first.id
}
