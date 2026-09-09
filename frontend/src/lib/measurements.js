/* Body measurements — the tape, alongside the scale.
 *
 * Weight alone is a poor read on a recomposition: someone eating at maintenance and training
 * hard can hold the same number for months while their waist drops and their arms don't. That
 * is the single most common reason a client decides the plan "isn't working", so the tape is
 * what a coach reaches for to show them it is.
 *
 * Shaped deliberately like `S.bodyweight`: a flat, date-sorted array in the synced state blob,
 * one entry per site per day, upserted. That is not laziness — it is what makes this free:
 *
 *   · the same sync path, the same last-write-wins on `_ts`, no second merge rule to reason
 *     about and no second answer to "where did my data go"
 *   · `seriesFor` emits exactly the `{t, y, d}` LineChart already draws for body weight
 *   · the coach view gets it by adding one field to GET /api/coach/member, because the panels
 *     are prop-driven
 *
 * Two choices worth defending:
 *
 * **No left/right.** Arms and thighs differ, and some apps track both. Doing so doubles the
 * entry work for every client at every check-in, and the asymmetry it reveals is not something
 * a tape measure can establish — a 3 mm difference is inside measurement error. v1 records one
 * number per site; a coach who cares about a real imbalance is watching lifts, not tape.
 *
 * **No unit of its own.** Length follows `S.unit`: kg means cm, lb means inches. A separate
 * setting is one more thing to get wrong, and someone who logs in pounds and measures in
 * centimetres is rare enough that the honest fix for them is to log in kg. Everything goes
 * through `lengthUnit()` so there is exactly one place to change if that ever stops being true.
 */

/** Stable keys — these end up in the synced blob, so they must never be renamed. */
export const SITES = ['neck', 'chest', 'arm', 'waist', 'hips', 'thigh', 'calf']

/** In tape order, top down, which is also the order the log sheet lists them. */
export const SITE_LABEL = {
  neck: 'Neck',
  chest: 'Chest',
  arm: 'Arm',
  waist: 'Waist',
  hips: 'Hips',
  thigh: 'Thigh',
  calf: 'Calf',
}

export const lengthUnit = S => (S?.unit === 'lb' ? 'in' : 'cm')

/** Plausible-range guard, in the profile's own unit. Wide on purpose: this is here to catch a
 *  slipped decimal point or a value typed in the wrong unit, not to have an opinion on bodies. */
export const rangeFor = S => (lengthUnit(S) === 'in' ? { min: 1, max: 100 } : { min: 3, max: 250 })

export const isValidValue = (S, v) => {
  const { min, max } = rangeFor(S)
  return Number.isFinite(v) && v >= min && v <= max
}

/**
 * Add or replace one reading, returning a new sorted array. Pure so the store's `update` stays
 * a one-liner and this is testable without a store.
 *
 * Same day + same site replaces, exactly like a second weigh-in on one day: the tape is meant
 * to be read once, and someone re-measuring immediately is correcting themselves, not recording
 * a trend. Different sites on the same day coexist — that is the normal case, a check-in.
 */
export function upsertMeasurement(list, { d, site, v, t = Date.now() }) {
  const rest = (list || []).filter(m => !(m.d === d && m.site === site))
  return [...rest, { d, site, v, t }].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
}

export function removeMeasurement(list, d, site) {
  return (list || []).filter(m => !(m.d === d && m.site === site))
}

/** Every reading for one site, oldest first, as LineChart points. */
export function seriesFor(S, site, days = 0) {
  const cutoff = days ? Date.now() - days * 86400000 : 0
  return (S?.measurements || [])
    .filter(m => m.site === site)
    .map(m => ({ t: m.t || new Date(m.d).getTime(), y: m.v, d: m.d }))
    .filter(p => !cutoff || p.t > cutoff)
    .sort((a, b) => a.t - b.t)
}

/** The most recent reading per site, keyed by site. Absent sites are simply missing. */
export function latestBySite(S) {
  const out = {}
  for (const m of S?.measurements || []) {
    if (!out[m.site] || m.d >= out[m.site].d) out[m.site] = m
  }
  return out
}

/**
 * Change over a window, per site: `{ site: { from, to, delta, days } }`.
 *
 * Needs two readings inside the window to say anything, and returns nothing for a site with
 * one. A single measurement is a starting point, not a trend, and reporting `delta: 0` for it
 * would show a client "no change" when what happened is "no second measurement".
 */
export function deltasOver(S, days = 90) {
  const cutoff = Date.now() - days * 86400000
  const out = {}
  for (const site of SITES) {
    const pts = seriesFor(S, site).filter(p => p.t > cutoff)
    if (pts.length < 2) continue
    const from = pts[0]
    const to = pts[pts.length - 1]
    out[site] = {
      from: from.y,
      to: to.y,
      delta: Math.round((to.y - from.y) * 10) / 10,
      days: Math.round((to.t - from.t) / 86400000),
    }
  }
  return out
}

/** Sites this profile has ever recorded, in SITES order — what the Stats panel offers. */
export const sitesUsed = S => {
  const seen = new Set((S?.measurements || []).map(m => m.site))
  return SITES.filter(s => seen.has(s))
}
