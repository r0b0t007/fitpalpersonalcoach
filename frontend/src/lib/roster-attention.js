// What needs the coach today, from the roster alone.
//
// The coach opens the app several times a day to triage, not to browse, so the first thing on
// their Today is this list: one row per client who needs something, most pressing first. Scored
// here, in a pure helper with a test, from the fields GET /api/coach/members already sends — the
// same trade adherence.js makes: the server ships facts, the client decides what they mean.
//
// One row per client, not one per reason. A client who is both a week off training and late on
// their check-in is one person to talk to, and two rows for them would push someone else off the
// screen. The reasons rank in the order a coach would act on them: an unanswered program is a
// conversation waiting to happen; a decline is a conversation that already went wrong; a new
// client with nothing to train is the one thing that only the coach can fix today; then the
// slower drifts — no check-in, no training — which are what this list exists to catch before the
// client stops opening the app.
import { checkinOverdue } from './checkins.js'
import { t, tp } from './i18n-core.js'

export const INACTIVE_DAYS = 7
export const NEW_DAYS = 7
// How long a decline stays a thing to do something about. `lastDecision` is the newest decided
// assignment for that member, with no end date of its own, so without a bound one decline from
// January outranks every live problem forever — and this list shows ONE row per client, so the
// stale row is not merely noise, it hides the real one. Two weeks is long enough to still be
// worth a conversation and short enough not to become furniture. (A later acceptance clears it
// on its own: `lastDecision` only ever holds the most recent decision.)
export const DECLINE_DAYS = 14

const DAY = 86400000
const noon = iso => Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')
// Whole days between a date-ish value (ISO day, ISO timestamp, or ms) and the roster's today.
export const daysSince = (v, todayIso) => {
  if (v == null) return null
  const ts = typeof v === 'number' ? v : (String(v).length === 10 ? noon(v) : Date.parse(v))
  if (!Number.isFinite(ts)) return null
  return Math.max(0, Math.round((noon(todayIso) - ts) / DAY))
}
const ago = n => (n == null ? '' : n === 0 ? t('today') : n === 1 ? t('yesterday') : tp(n, '{0} day ago', '{0} days ago'))

const REASONS = [
  {
    type: 'program-waiting',
    when: m => m.pending?.length > 0,
    title: () => t('Program not answered'),
    detail: (m, today) => t('Sent {0}', ago(daysSince(m.pending[0].created, today))),
  },
  {
    type: 'declined',
    when: (m, today) => m.lastDecision?.status === 'declined' && daysSince(m.lastDecision.at, today) <= DECLINE_DAYS,
    title: () => t('Declined the last program'),
    detail: (m, today) => ago(daysSince(m.lastDecision.at, today)),
  },
  {
    type: 'new-client',
    when: (m, today) => m.routines === 0 && daysSince(m.created, today) != null && daysSince(m.created, today) <= NEW_DAYS,
    title: () => t('New client, no program yet'),
    detail: (m, today) => t('Joined {0}', ago(daysSince(m.created, today))),
  },
  {
    type: 'no-program',
    // `=== 0`, not `!(x > 0)`: `routines`, `lastCheckin` and `checkinDay` are new on the wire,
    // and the static frontend and the live API are separate deploy paths (CLAUDE.md). A bundle
    // served against an API that has not shipped them yet would otherwise label EVERY client
    // "No program" and bury every real signal. An absent field means unknown, so: no row.
    when: m => m.routines === 0,
    title: () => t('No program'),
    detail: () => t('Nothing on their plan to train'),
  },
  {
    // Their check-ins are withheld until they agree in the app (CHW-360), so "overdue" would be a
    // guess. `false` only: an API from before the field sends nothing (see 'no-program').
    type: 'health-not-shared',
    when: m => m.healthShared === false,
    title: () => t('Health data not shared yet'),
    detail: () => t('Check-ins, weight and photos show once they agree in the app'),
  },
  {
    type: 'checkin-overdue',
    // Only once they have something to train — a check-in on an empty plan is not a habit anyone
    // agreed to yet, and the row above already says what is missing. `undefined` is an API that
    // predates the field (see 'no-program'); `null` is a client who has genuinely never filed one.
    when: (m, today) => m.lastCheckin !== undefined && m.healthShared !== false && checkinOverdue(m, today),
    title: () => t('Check-in overdue'),
    detail: (m, today) => (m.lastCheckin ? t('Last one {0}', ago(daysSince(m.lastCheckin, today))) : t('None filed yet')),
  },
  {
    type: 'inactive',
    when: (m, today) => !m.live && (m.lastWorkout == null || daysSince(m.lastWorkout, today) >= INACTIVE_DAYS),
    title: () => t('Not training'),
    detail: (m, today) => (m.lastWorkout ? t('Last workout {0}', ago(daysSince(m.lastWorkout, today))) : t('No workouts yet')),
  },
]

export function reasonFor(m, todayIso) {
  const i = REASONS.findIndex(r => r.when(m, todayIso))
  if (i < 0) return null
  const r = REASONS[i]
  return { type: r.type, rank: i, title: r.title(), detail: r.detail(m, todayIso) }
}

export function attentionItems(members, todayIso) {
  const out = []
  for (const m of members || []) {
    if (m.disabled) continue
    const r = reasonFor(m, todayIso)
    if (r) out.push({ ...r, id: m.id, name: m.name })
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
}
