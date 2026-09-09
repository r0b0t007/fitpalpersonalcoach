/**
 * Adherence — did they train on the days their plan says they train?
 *
 * The one metric in the coach view that is not already derivable from the client's own screens:
 * every other panel answers "how is this going", this one answers "are they showing up". Pure,
 * like everything else in this directory, so the coach roster and the client's own Stats can
 * both call it without either owning it.
 *
 * Three decisions worth knowing about, because each one changes what the number means:
 *
 * 1. **A day is the unit, not a routine.** A combined day (`S.week[wd]` holding two routines)
 *    is one trip to the gym. Scoring it as two makes a client who went and trained look like
 *    they half-missed, and it makes the denominator drift as they reorganise their split
 *    without changing how often they train. Counting days also keeps the number in the same
 *    language coaches already use — sessions per week.
 *
 * 2. **Today is pending, never a miss.** The day is not over. Counting it would mean every
 *    client's adherence visibly dips each morning and recovers each evening, which trains a
 *    coach to ignore the number. It is excluded from both sides of the ratio until it is past.
 *
 * 3. **A workout on the day counts, whatever they trained.** Not "did they run the prescribed
 *    routine" — this measures attendance, and swapping Pull for Push on a Tuesday is not a
 *    missed session. Training on an unplanned day is `extra`: reported, never scored, because
 *    it is not a failure and inflating the rate past 100% would hide real misses.
 *
 * The honest limitation: `S.week` and `S.dayPlan` describe the plan **as it stands now**. The
 * app keeps no history of what the plan used to be, so a split rewritten mid-window re-scores
 * days that were judged against a different plan at the time. There is nowhere to read the old
 * plan from, so the fix is not here — it is a caller-side caveat when a plan just changed.
 */
import { isoOf } from './format.js'
import { effectiveRoutineIds } from './history.js'

export const ADHERENCE_WINDOW_DAYS = 28

/** Every ISO date in the window ending at `toIso` inclusive, oldest first. */
function windowDays(toIso, days) {
  const out = []
  const d = new Date(toIso + 'T12:00:00')
  d.setDate(d.getDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    out.push(isoOf(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * Where the window's near end sits: the join date, pulled back to the first logged day when
 * history predates the account, and never past today. `null` means "no clamp" — score the whole
 * window. Both adjustments exist because the unclamped version was wrong in production-shaped
 * ways; see the two bullets on `created` below.
 */
function windowStart(joined, firstTrained, todayIso) {
  if (!joined) return null
  const start = firstTrained && firstTrained < joined ? firstTrained : joined
  return start > todayIso ? todayIso : start
}

/**
 * The metric, over the four facts it actually needs — not a whole client state.
 *
 * That is what lets the coach roster score every member without pulling each one's full state:
 * `GET /api/coach/members` sends exactly these four fields per member, and the opened member's
 * detail view builds the same shape from its own richer payload. One implementation, two
 * callers, no second definition of what "adhering" means drifting away from this one.
 *
 * The server trims `dayPlan` and `trainedDays` to the window before sending — `dayPlan` keeps an
 * entry for every date the client has ever rescheduled, which would otherwise grow the roster
 * payload without bound. That trim is safe because nothing outside the window can change the
 * answer, and there is a test below holding that property so the server can keep relying on it.
 *
 * `created` is the member's join date and clamps the near end of the window. Without it a
 * client added on Monday who sets a Mon/Wed/Fri week is scored against the three weeks before
 * they existed and lands on the roster in red — the same "red flag on someone who has done
 * nothing wrong" this module refuses to print for a member with no plan.
 *
 * Two things stop that clamp turning into its own bug, both learned the hard way:
 *
 *   · **It never lands after today.** `created` is a UTC instant and `todayIso` is the viewer's
 *     local date, so for a coach west of UTC a member who signed up this evening carries a join
 *     date of *tomorrow*. Filtering on that leaves an empty window: no days, no rate, and a card
 *     reading "nothing to miss yet" about someone who trained an hour ago.
 *   · **Training older than the account wins.** History can be imported (`import-hevy.js`), so a
 *     member who signs up and pulls in a year of Hevy data has months of workouts predating
 *     `created`. The account date is not when they started training, and using it would blank a
 *     coach's view of exactly the client who arrived with the most to look at.
 *
 * `routineIds` must contain only routines that have exercises. A routine with none cannot be
 * started — `nextTrainingDay` skips it and the TabBar refuses it — so a day holding only empty
 * routines is not a day anybody could have trained, and scoring it as missed would mark someone
 * absent from a session their own app would not let them begin.
 *
 * @param {{week?:object, dayPlan?:object, routineIds?:string[], trainedDays?:string[],
 *          created?:string}} parts
 * @param {string} todayIso  taken as an argument, not read from the clock, so callers and
 *                           tests agree on "today" — the same contract as nextTrainingDay.
 * @param {number} days   window length, ending today. Today itself is pending (see above).
 *
 * @returns {{planned:number, trained:number, missed:number, extra:number, rate:number|null,
 *            pending:boolean, days:Array<{iso:string, planned:boolean, trained:boolean,
 *            state:'trained'|'missed'|'extra'|'rest'|'pending'}>}}
 *   `rate` is 0..1, or **null** when nothing was planned in the window — a client with no plan
 *   has not achieved 0%, they have no adherence to report, and 0 would read as a red flag on
 *   someone who has done nothing wrong.
 */
export function adherenceOf(parts, todayIso, days = ADHERENCE_WINDOW_DAYS) {
  const trainedOn = new Set(parts?.trainedDays || [])
  // Timestamps and plain dates both appear here — user.created is an ISO instant on the wire.
  const joined = parts?.created ? String(parts.created).slice(0, 10) : null
  // Earliest logged day, which may predate the account when history was imported.
  const firstTrained = trainedOn.size ? [...trainedOn].sort()[0] : null
  const from = windowStart(joined, firstTrained, todayIso)
  // effectiveRoutineIds drops a weekday pointing at a routine that no longer exists, so it
  // needs the ids — a deleted routine leaves its id behind in `week`, and a day nobody can
  // train is not a day anyone missed.
  const state = {
    week: parts?.week || {},
    dayPlan: parts?.dayPlan || {},
    routines: (parts?.routineIds || []).map(id => ({ id })),
  }

  let planned = 0
  let trained = 0
  let extra = 0

  const list = windowDays(todayIso, days).filter(iso => !from || iso >= from).map(iso => {
    const isPlanned = effectiveRoutineIds(state, iso).length > 0
    const didTrain = trainedOn.has(iso)
    // Today is scored on neither side, but a session already logged today still shows as
    // trained — hiding it would make the strip disagree with the workout they just finished.
    // Only a *planned* today is pending: on a rest day there is nothing still to come, and
    // saying so would put "today still to come" under a week that never asked for it.
    if (iso === todayIso) {
      const label = didTrain ? 'trained' : isPlanned ? 'pending' : 'rest'
      return { iso, planned: isPlanned, trained: didTrain, state: label }
    }
    if (isPlanned) {
      planned++
      if (didTrain) trained++
      return { iso, planned: true, trained: didTrain, state: didTrain ? 'trained' : 'missed' }
    }
    if (didTrain) extra++
    return { iso, planned: false, trained: didTrain, state: didTrain ? 'extra' : 'rest' }
  })

  return {
    planned,
    trained,
    missed: planned - trained,
    extra,
    rate: planned ? trained / planned : null,
    pending: list[list.length - 1]?.state === 'pending',
    days: list,
  }
}

/**
 * Three bands, because a coach scanning a roster is asking "who do I message today" — a
 * three-way answer, not a gradient. The thresholds are the judgement, so they live here with a
 * test on them; the colours that render them are the view's business.
 *
 *   on-track   >= 80%  — on a 3-day split, roughly one missed session a fortnight
 *   slipping   >= 50%  — training, but not to the plan; worth a message before it becomes a habit
 *   off-track   < 50%  — the plan and the person have parted ways; the plan is usually the problem
 *
 * `null` for a null rate: someone with no training week has no adherence, and calling that
 * "off-track" points the finger at a member who has done nothing wrong.
 */
export const ADHERENCE_ON_TRACK = 0.8
export const ADHERENCE_SLIPPING = 0.5

export function adherenceBand(rate) {
  if (rate == null) return null
  if (rate >= ADHERENCE_ON_TRACK) return 'on-track'
  if (rate >= ADHERENCE_SLIPPING) return 'slipping'
  return 'off-track'
}
