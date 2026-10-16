// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t, tp } from './i18n-core.js'
export const todayISO = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export const isoOf = d =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso, long, withYear = false) {
  const d = new Date(iso + 'T12:00:00')
  const options = long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }
  if (withYear) options.year = 'numeric'
  return d.toLocaleDateString(dateLocale(), options)
}
export function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart = ms => (ms >= 60000 ? [fmtDur(ms)] : [])
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
export const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString(dateLocale())
// A byte count in MB, in the language's own separator and unit ("12,4 Mo"): one decimal under
// 10 MB, where it still says something, whole numbers above.
export const fmtMB = b => {
  const d = b < 10485760 ? 1 : 0
  return t('{0} MB', (b / 1048576).toLocaleString(dateLocale(), { minimumFractionDigits: d, maximumFractionDigits: d }))
}
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol = (v, unit) => fmtNum(v) + ' ' + unit
// Plural forms are not automatic when the English string is the key.
export const exCount = n => tp(n, '{0} exercise', '{0} exercises')

/* ---------------------------------------------------------------- week start --
   Where a week begins is a local convention, not a fact: most of Europe starts on
   Monday, most of the Americas and much of Asia on Sunday. The app used to assume
   Monday everywhere — the Plan list, the Home strip, the calendar grid and every
   "this week" total. It is now S.weekStart, a getDay() index, and every one of those
   places asks these helpers instead of writing the assumption down again.

   Only 1 and 0 are offered in the UI, but the helpers work for any weekday, so a
   Saturday start (parts of the Middle East) would need a locale string and nothing
   else. */
export const MONDAY = 1
export const SUNDAY = 0
/** The profile's first weekday, defaulting to Monday for every state written before this. */
export const weekStartOf = S => (S?.weekStart === SUNDAY ? SUNDAY : MONDAY)
/** getDay() indices in display order — [1..6,0] for a Monday start, [0..6] for a Sunday one. */
export const weekOrder = (ws = MONDAY) => Array.from({ length: 7 }, (_, i) => (ws + i) % 7)
/** How many days a weekday sits past the start of its week. 0..6, so it doubles as a column. */
export const weekDayOffset = (day, ws = MONDAY) => (day - ws + 7) % 7

/** The Date (noon local, so DST cannot shift the day) that starts the week `iso` falls in. */
export function startOfWeek(iso, ws = MONDAY) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - weekDayOffset(d.getDay(), ws))
  return d
}

/**
 * A key that is equal for two dates in the same week: the ISO date of the week's first day.
 *
 * Only ever compared or used as a map key — never shown, never stored — so it does not need
 * to be an ISO week number, and being one would be a liability here: "2026-35" is defined
 * Monday-first, and there is no Sunday-first equivalent to fall back to.
 */
export const weekKey = (iso, ws = MONDAY) => isoOf(startOfWeek(iso, ws))

export const localTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const ACCENTS = { lime: '#30d158', sky: '#0a84ff', orange: '#ff9f0a', violet: '#bf5af2', pink: '#ff375f', red: '#ff453a', teal: '#40c8e0', gold: '#D4AF37' }
// What a screen reader calls each swatch. Literal t() calls rather than a lookup table, so
// check-source-strings can see the keys.
export const accentName = k => ({
  lime: t('Lime'), sky: t('Sky blue'), orange: t('Orange'), violet: t('Violet'),
  pink: t('Pink'), red: t('Red'), teal: t('Teal'), gold: t('Gold'),
})[k] || k
