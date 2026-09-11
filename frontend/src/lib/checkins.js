/* Weekly check-ins — the retention mechanic, and the only channel in the app where a client
 * tells their coach something the training data cannot.
 *
 * Adherence says whether they turned up. The tape says what changed. Neither says they have been
 * sleeping five hours, that work is brutal this month, or that the left knee has been talking
 * since Tuesday — and those are what a coach changes the plan for. Every comparable platform
 * ships structured check-ins and every write-up names them as *the* thing that keeps clients
 * around; the ones that skip it lose people quietly.
 *
 * Stored as `S.checkins[]` in the client's own synced blob, exactly like bodyweight and
 * measurements, and read by the coach through the same `GET /api/coach/member`. That is a
 * deliberate constraint, not a shortcut: the app's sync is whole-state replacement, so anything
 * the *server* writes into a client's state file is destroyed by that client's next push. A
 * check-in the client authors is the only kind that can live there safely.
 *
 * Scales are 1-5 and all point the same way — 5 is always the good end. Mixing directions
 * ("5 = worst soreness" next to "5 = best sleep") is the classic survey error: it reads fine to
 * whoever wrote the form and produces garbage from everyone else. Soreness and stress are
 * therefore phrased as their positive pole, so a row of 5s means a good week and a coach can
 * scan a column without translating each row.
 */
import { isoOf } from './format.js'

/** Stable ids — these are keys in the synced blob and must never be renamed. */
export const QUESTIONS = [
  { id: 'energy', label: 'Energy', hint: 'How you felt in the gym and out of it' },
  { id: 'sleep', label: 'Sleep', hint: 'Hours and quality together' },
  { id: 'recovery', label: 'Recovery', hint: '5 = fresh, 1 = still sore from last time' },
  { id: 'stress', label: 'Life stress', hint: '5 = calm week, 1 = relentless' },
  { id: 'nutrition', label: 'Nutrition', hint: 'How closely you ate the way you meant to' },
]

export const SCALE_MIN = 1
export const SCALE_MAX = 5
export const NOTE_MAX = 1000

/** 0 = Sunday, matching getDay() and S.weekStart. Sunday is the default: it is the day people
 *  review a week, and it keeps the check-in out of the Monday session. */
export const DEFAULT_CHECKIN_DAY = 0

export const checkinDayOf = S => {
  const d = S?.checkinDay
  return Number.isInteger(d) && d >= 0 && d <= 6 ? d : DEFAULT_CHECKIN_DAY
}

/**
 * The most recent occurrence of the check-in weekday, on or before `todayIso`. This is the start
 * of the period a check-in belongs to: one submitted on any day from here until the next
 * occurrence counts for this week.
 */
export function periodStart(S, todayIso) {
  const want = checkinDayOf(S)
  const d = new Date(todayIso + 'T12:00:00')
  const back = (d.getDay() - want + 7) % 7
  d.setDate(d.getDate() - back)
  return isoOf(d)
}

/**
 * Is one owed right now?
 *
 * True from the check-in day onward until one is filed, and never before — a client who checked
 * in on Sunday is not nagged again on Monday. Deliberately not "more than 7 days since the last
 * one": that drifts, so someone who is a day late once is a day late forever, and the reminder
 * slowly wanders across their week.
 */
export function isCheckinDue(S, todayIso) {
  const from = periodStart(S, todayIso)
  return !(S?.checkins || []).some(c => c.d >= from)
}

/**
 * isCheckinDue for the coach's roster, which carries a member's check-in day and newest check-in
 * date (GET /api/coach/members) but not their state. Same rule — owed from the check-in day
 * onward until one is filed for that period — so the coach's "check-in overdue" row and the
 * member's own Home card agree on the day. checkins.overdue.test.js holds them together.
 */
export function checkinOverdue({ checkinDay, lastCheckin }, todayIso) {
  return !lastCheckin || lastCheckin < periodStart({ checkinDay }, todayIso)
}

/** The check-in filed for the current period, if there is one. */
export function currentCheckin(S, todayIso) {
  const from = periodStart(S, todayIso)
  return (S?.checkins || []).find(c => c.d >= from) || null
}

export const isValidAnswer = v =>
  Number.isInteger(v) && v >= SCALE_MIN && v <= SCALE_MAX

/**
 * Add or replace the check-in for one date. Pure, returns a new sorted array.
 *
 * Answers are stored sparsely: a question left blank is absent rather than 0, so "did not
 * answer" and "answered badly" never collapse into the same number on a coach's screen.
 */
export function upsertCheckin(list, { d, answers = {}, note = '', t = Date.now() }) {
  const clean = {}
  for (const q of QUESTIONS) if (isValidAnswer(answers[q.id])) clean[q.id] = answers[q.id]
  const entry = { d, answers: clean, t }
  const trimmed = String(note || '').trim().slice(0, NOTE_MAX)
  if (trimmed) entry.note = trimmed
  return [...(list || []).filter(c => c.d !== d), entry].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
}

export const removeCheckin = (list, d) => (list || []).filter(c => c.d !== d)

/** Mean of the answered scales, or null when nothing was answered — never 0, which would read
 *  as the worst possible week rather than as an empty form. */
export function scoreOf(checkin) {
  const vals = QUESTIONS.map(q => checkin?.answers?.[q.id]).filter(isValidAnswer)
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
}

/** One question's history as LineChart points, oldest first — the same shape as everything else. */
export function seriesFor(S, questionId) {
  return (S?.checkins || [])
    .filter(c => isValidAnswer(c.answers?.[questionId]))
    .map(c => ({ t: c.t || new Date(c.d).getTime(), y: c.answers[questionId], d: c.d }))
    .sort((a, b) => a.t - b.t)
}

/**
 * Consecutive filed check-ins counting back from the current period.
 *
 * The current period counts only if it has been filed — an unfiled week in progress is not a
 * broken streak, it is a week that has not finished. Without that, every client's streak would
 * read 0 for the six days between the check-in day and their answering it.
 */
export function checkinStreak(S, todayIso) {
  const filed = new Set((S?.checkins || []).map(c => periodStart(S, c.d)))
  let n = 0
  const d = new Date(periodStart(S, todayIso) + 'T12:00:00')
  if (!filed.has(isoOf(d))) d.setDate(d.getDate() - 7)   // this week is still open, start at last
  for (let i = 0; i < 520; i++) {
    if (!filed.has(isoOf(d))) break
    n++
    d.setDate(d.getDate() - 7)
  }
  return n
}
