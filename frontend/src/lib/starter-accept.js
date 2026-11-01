// A coach's starter program (CHW-338): the offer a page's accept comes with, marked `auto`, which
// the client's app takes in by itself (store/useStore.js loadAssignments), so workout 1 is there
// the day they join instead of "{coach} is preparing your program". Pure: it decides what the
// client lifts first, so it has a test beside it (CONTRIBUTING).
import { mergePlan } from './plan-share.js'
import { effectiveRoutineIds } from './history.js'

/**
 * Merges a starter bundle (as parsePlan hands it over) into the state, scheduled as the coach set
 * it, then puts its first routine with something in it on `today` when nothing is planned there:
 * the program may start on a Monday, and the person joined on a Wednesday. A day the client marked
 * as rest stays rest. A mutator for update(); returns the routine id put on today, or null.
 */
export function applyStarter(s, bundle, today) {
  s.dayPlan = s.dayPlan || {}
  s.week = s.week || {}
  s.routines = s.routines || []
  const before = s.routines.length
  mergePlan(s, bundle, { schedule: true })
  if (s.dayPlan[today] === 'rest' || effectiveRoutineIds(s, today).length) return null
  const first = s.routines.slice(before).find(r => (r.ex || []).length)
  if (!first) return null
  s.dayPlan[today] = first.id
  return first.id
}
