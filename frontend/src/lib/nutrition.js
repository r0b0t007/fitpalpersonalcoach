/* Nutrition v1 — log a food with grams, see four numbers against the target the coach set.
 *
 * Four numbers, deliberately: calories, protein, carbs, fat. Nothing else. Every food tracker
 * that ships micronutrients, water, recipes and meal plans in v1 ships a form nobody fills in by
 * week three, and a coach who cannot read a client's week at a glance stops looking. The whole
 * feature is "did they eat roughly what we agreed", and four numbers answer that.
 *
 * **Entries denormalise their macros.** A logged entry is
 *
 *     { id, d, n, g, kcal, p, c, f, s, t }
 *
 * — the name AND the four numbers as eaten, already scaled for the grams. `s` is provenance: a
 * note about where the numbers came from (the id of the row in `S.foods` they were copied from,
 * or '' when they were typed fresh). Nothing ever resolves it, and nothing may start to. That is
 * the property the whole feature rests on: a food logged in a kitchen with no signal, or in a
 * gym basement, is complete the moment it is written. Rename the food later, delete it from
 * `S.foods`, restore an old backup — last Tuesday's lunch still reads back exactly as logged.
 * A foreign key would turn every one of those into a blank row.
 *
 * **Entries live in the synced blob `S`, not in a sidecar with its own endpoints.** They ride the
 * same last-write-wins on `_ts` and the same `gym_dirty` flag as workouts and weigh-ins, so
 * offline, retry and dedupe are already written and already tested. The accepted cost is the one
 * workouts already pay: log breakfast on the phone and lunch on the laptop, both offline, and one
 * of them loses. That is a real cost and it is not worth a CRDT to avoid — someone logging meals
 * from two devices in the same unsynced hour is rarer than someone logging none at all because
 * the feature needed a network.
 *
 * **The target is never written by the server.** `PUT /api/data` replaces the state file whole,
 * so a coach-set target written server-side would be destroyed by the client's next push. It
 * arrives on the assignment bundle the member already accepts (`nutrition` on the plan bundle,
 * validated in api/domain.mjs) and the client writes it into `S.nutriTarget` as part of that
 * accept. Zero new routes, zero new auth surface.
 *
 * **`S.foods` is the search index and the only one.** ~200 things this person actually eats,
 * kept in use order so filtering the list is already ranking it. There is no food database
 * behind this and v1 does not pretend otherwise: a network food lookup needs a licence
 * discussion that has not happened, and the ten foods someone eats every week are the ninety
 * percent case anyway.
 */
import { isoOf } from './format.js'

/** Stable keys — these are field names in the synced blob and must never be renamed. */
export const MACROS = ['kcal', 'p', 'c', 'f']

export const NAME_MAX = 60
export const GRAMS_MAX = 5000

/** Per-100 g ceilings, as a slipped-decimal guard rather than an opinion about food. Nothing
 *  edible exceeds 900 kcal per 100 g (pure fat is ~900), and no macro can exceed 100 g of it. */
export const PER100_MAX = { kcal: 900, p: 100, c: 100, f: 100 }

/** Personal food list cap. Big enough that nobody who eats normally ever evicts something they
 *  still use, small enough that the list stays a rounding error in a state blob that is pushed
 *  whole on every sync. */
export const FOODS_MAX = 200

/** How long individual entries are kept before they roll up (see compactMeals). Four months is
 *  past every "what did I eat when I was leaning out in March" question a client actually asks,
 *  and it is the window a coach reviews. */
export const MEALS_KEEP_DAYS = 120

/** How long the rolled-up day rows are kept. Three years of four numbers a day is ~15 KB, so
 *  this is a backstop against forever rather than a retention policy anyone will notice. */
export const MEAL_DAYS_KEEP_DAYS = 1095

const r1 = n => Math.round(n * 10) / 10
const num = v => (Number.isFinite(+v) ? +v : 0)

const shiftISO = (iso, days) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

export const ZERO = { kcal: 0, p: 0, c: 0, f: 0 }

/* ---------- foods ---------- */

/** Foods are matched by name, case- and space-insensitively: "Greek yoghurt" typed again is the
 *  same food, not a second row with slightly different numbers. */
export const foodKey = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ')

export const isValidPer100 = (key, v) =>
  Number.isFinite(v) && v >= 0 && v <= (PER100_MAX[key] ?? 0)

/** A food is loggable when it has a name and four in-range numbers per 100 g. Calories are the
 *  one that may not be left blank — a food with no calories is not a food, it is an empty form. */
export function isValidFood(food) {
  if (!food || !foodKey(food.n)) return false
  if (!Number.isFinite(food.kcal) || food.kcal <= 0 || food.kcal > PER100_MAX.kcal) return false
  return MACROS.slice(1).every(k => isValidPer100(k, num(food[k])))
}

export const isValidGrams = g => Number.isFinite(g) && g > 0 && g <= GRAMS_MAX

/** Normalise one food row to exactly the keys the blob carries — a caller cannot smuggle extra
 *  fields into state that the next reader would then have to reason about. */
export const cleanFood = food => ({
  id: String(food.id || ''),
  n: String(food.n || '').trim().slice(0, NAME_MAX),
  kcal: Math.round(num(food.kcal)),
  p: r1(num(food.p)),
  c: r1(num(food.c)),
  f: r1(num(food.f)),
})

/**
 * Put a food at the head of the personal list, evicting the least recently used past the cap.
 * Pure, returns a new array.
 *
 * Re-logging a food you already have UPDATES it rather than adding a twin: the same name is the
 * same food, and someone who corrects the calories of their bread means the correction to stick.
 * The head of the list is "most recently used", which is what makes searchFoods below need no
 * ranking of its own.
 */
export function rememberFood(foods, food, { max = FOODS_MAX } = {}) {
  const clean = cleanFood(food)
  const key = foodKey(clean.n)
  const rest = (foods || []).filter(x => foodKey(x.n) !== key && x.id !== clean.id)
  return [clean, ...rest].slice(0, max)
}

export const removeFood = (foods, id) => (foods || []).filter(x => x.id !== id)

/**
 * The personal list, filtered. Order is left alone on purpose: the list is already in use order,
 * so the most recently eaten match sorts first without a scoring pass. An empty query returns the
 * head of the list, which is the right answer to "what do I usually log".
 */
export function searchFoods(foods, query, limit = 8) {
  const q = foodKey(query)
  const list = foods || []
  return (q ? list.filter(x => foodKey(x.n).includes(q)) : list).slice(0, limit)
}

/* ---------- entries ---------- */

/** The four numbers for `grams` of a food whose own numbers are per 100 g. */
export function scaleFood(food, grams) {
  const k = num(grams) / 100
  return {
    kcal: Math.round(num(food.kcal) * k),
    p: r1(num(food.p) * k),
    c: r1(num(food.c) * k),
    f: r1(num(food.f) * k),
  }
}

/**
 * Build the entry that gets written into `S.meals`. `id` comes from the caller (uid()) rather
 * than from here so this stays deterministic under test, exactly like upsertMeasurement's `t`.
 *
 * The macros are baked in here and never recomputed. See the note at the top of the file: this
 * is the line that makes an entry survive its food being renamed, edited or deleted.
 */
export function loggedFood(food, grams, { id, d, t = Date.now() }) {
  return {
    id,
    d,
    n: String(food.n || '').trim().slice(0, NAME_MAX),
    g: r1(num(grams)),
    ...scaleFood(food, grams),
    // Provenance, not a reference. Read it to say "this came from your list"; never look it up.
    s: String(food.id || ''),
    t,
  }
}

/** Append and keep the list in day order, oldest first — the same ordering every other series in
 *  the blob uses, so a chart never has to sort. */
export const addMeal = (list, entry) =>
  [...(list || []), entry].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t - b.t))

export const removeMeal = (list, id) => (list || []).filter(m => m.id !== id)

export const sumEntries = list => (list || []).reduce((acc, m) => ({
  kcal: acc.kcal + num(m.kcal),
  p: r1(acc.p + num(m.p)),
  c: r1(acc.c + num(m.c)),
  f: r1(acc.f + num(m.f)),
}), { ...ZERO })

export const entriesOn = (S, iso) => (S?.meals || []).filter(m => m.d === iso)

const rowTotals = row => ({
  kcal: num(row[0]), p: r1(num(row[1])), c: r1(num(row[2])), f: r1(num(row[3])),
})

/**
 * What was eaten on one day. Live entries win over a rolled-up row for the same date: a day can
 * only be in one of the two states, and reading the entries is the truthful answer while they
 * still exist.
 */
export function totalsFor(S, iso) {
  const live = entriesOn(S, iso)
  if (live.length) return sumEntries(live)
  const row = (S?.mealDays || {})[iso]
  return row ? rowTotals(row) : { ...ZERO }
}

/**
 * Every day with intake, oldest first: `[{ d, kcal, p, c, f }]`. Rolled-up days and live entries
 * come back in one series, which is the whole point of the rollup — the chart must not have a
 * 120-day cliff in it where the entries stop.
 */
export function daySeries(S, days = 0, todayIso = isoOf(new Date())) {
  const from = days ? shiftISO(todayIso, -(days - 1)) : ''
  const byDay = new Map()
  for (const [d, row] of Object.entries(S?.mealDays || {})) {
    if (d >= from) byDay.set(d, rowTotals(row))
  }
  for (const m of S?.meals || []) {
    if (m.d < from) continue
    const cur = byDay.get(m.d)
    // A rolled row and live entries for the same date should not exist together, but a restored
    // backup can produce it. Live entries replace the row rather than adding to it: doubling a
    // day's calories is a worse answer than ignoring a row that should already be gone.
    byDay.set(m.d, cur && cur._live ? cur : { _live: true, ...ZERO })
    const t = byDay.get(m.d)
    t.kcal += num(m.kcal); t.p = r1(t.p + num(m.p)); t.c = r1(t.c + num(m.c)); t.f = r1(t.f + num(m.f))
  }
  return [...byDay.entries()]
    .map(([d, v]) => ({ d, kcal: v.kcal, p: v.p, c: v.c, f: v.f }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
}

/** Daily calories as LineChart points — the same `{t, y, d}` shape as body weight and the tape. */
export const kcalPoints = (S, days = 0, todayIso = isoOf(new Date())) =>
  daySeries(S, days, todayIso).map(r => ({ t: new Date(r.d + 'T12:00:00').getTime(), y: r.kcal, d: r.d }))

/**
 * Average intake across the days actually logged in a window, plus how many those were.
 *
 * Averaged over LOGGED days, never over the window: dividing by 14 when someone logged four days
 * reports a client eating 600 kcal, which is the single most misleading number this screen could
 * put in front of a coach. `logged` is what says whether the average means anything.
 */
export function averageOver(S, days = 14, todayIso = isoOf(new Date())) {
  const rows = daySeries(S, days, todayIso)
  if (!rows.length) return { logged: 0, days, ...ZERO }
  const sum = rows.reduce((a, r) => ({
    kcal: a.kcal + r.kcal, p: a.p + r.p, c: a.c + r.c, f: a.f + r.f,
  }), { ...ZERO })
  return {
    logged: rows.length,
    days,
    kcal: Math.round(sum.kcal / rows.length),
    p: r1(sum.p / rows.length),
    c: r1(sum.c / rows.length),
    f: r1(sum.f / rows.length),
  }
}

/* ---------- the target ---------- */

/**
 * The daily target, normalised, or null when there isn't one.
 *
 * Read through this rather than off `S.nutriTarget` directly, because a target can arrive from a
 * coach's bundle and every field on it is optional: a coach who sets calories and protein and
 * leaves carbs and fat alone means exactly that, and a screen that renders "0 g" against carbs
 * would be reporting a target nobody set.
 */
export function targetOf(S) {
  const raw = S?.nutriTarget
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const k of MACROS) if (Number.isFinite(+raw[k]) && +raw[k] > 0) out[k] = Math.round(+raw[k])
  if (!Object.keys(out).length) return null
  const note = String(raw.note || '').trim()
  return { ...out, ...(note ? { note } : {}), t: num(raw.t) }
}

/** `target - eaten` per macro: positive is how much is still LEFT, negative is how far over.
 *  Macros with no target are absent, not 0. The sign is stated here because this is the only
 *  place it is stated in words — MacroRows reads `>= 0` as "left" and every caller must. */
export function remainingOf(totals, target) {
  const out = {}
  if (!target) return out
  for (const k of MACROS) if (target[k] != null) out[k] = r1(num(target[k]) - num(totals?.[k]))
  return out
}

/** Does this profile use nutrition at all? What gates the Stats card, so nobody who has never
 *  logged a meal grows an empty panel on a screen they use every week. */
export const hasNutrition = S =>
  !!((S?.meals || []).length || Object.keys(S?.mealDays || {}).length || targetOf(S))

/* ---------- compaction ---------- */

/**
 * Roll entries older than `keepDays` into one row a day, `S.mealDays['2026-01-04'] = [kcal,p,c,f]`,
 * and drop rolled rows past MEAL_DAYS_KEEP_DAYS.
 *
 * Mirrors pruneRequests / pruneSessions / pruneAssignments in api/domain.mjs, for the same
 * reason and with the same shape: the whole thing is rewritten on every save, so the only way
 * something stops growing is if a pure function drops it on the way past. Meals are the first
 * thing in this blob written three to six times a DAY — at four months of entries that is a few
 * thousand objects re-serialised to localStorage and pushed over the wire on every keystroke's
 * worth of debounce. Rolled to four numbers a day it is a rounding error again.
 *
 * Returns null when there is nothing to roll, so the caller can skip a whole-state clone in the
 * overwhelmingly common case.
 */
export function compactMeals(S, todayIso, keepDays = MEALS_KEEP_DAYS) {
  const cutoff = shiftISO(todayIso, -keepDays)
  const meals = []
  const rolled = new Map()
  for (const m of S?.meals || []) {
    if (!m || m.d >= cutoff) { meals.push(m); continue }
    const row = rolled.get(m.d) || [0, 0, 0, 0]
    row[0] += num(m.kcal); row[1] += num(m.p); row[2] += num(m.c); row[3] += num(m.f)
    rolled.set(m.d, row)
  }
  const floor = shiftISO(todayIso, -MEAL_DAYS_KEEP_DAYS)
  const stale = Object.keys(S?.mealDays || {}).filter(d => d < floor)
  if (!rolled.size && !stale.length) return null

  const mealDays = {}
  for (const [d, row] of Object.entries(S?.mealDays || {})) if (d >= floor) mealDays[d] = row
  for (const [d, row] of rolled) {
    // A day that already has a row means this ran twice across a restored backup — add to it
    // rather than replacing, so re-importing yesterday's export never silently halves a day.
    const prev = mealDays[d] || [0, 0, 0, 0]
    mealDays[d] = [
      Math.round(row[0] + num(prev[0])), r1(row[1] + num(prev[1])),
      r1(row[2] + num(prev[2])), r1(row[3] + num(prev[3])),
    ]
  }
  return { meals, mealDays }
}
