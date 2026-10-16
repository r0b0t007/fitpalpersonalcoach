// Recent activity, from the roster alone: no event log on the server, just a merge of the
// timestamps GET /api/coach/members already carries — last workout, last program decision,
// last check-in, joined, training right now. That is enough to answer "what happened since I
// last looked" without another endpoint, and it is exactly as fresh as the roster poll.
//
// One event per member per kind, because the roster holds one date per kind. The feed is
// therefore a "latest per client" view, not a history — a history would be a server change, and
// nothing a coach does from this card needs one yet.
import { t } from './i18n-core.js'

const DAY = 86400000
const noon = iso => Date.parse(String(iso).slice(0, 10) + 'T12:00:00')

export function activityFeed(members, { now = Date.now(), limit = 12 } = {}) {
  const ev = []
  for (const m of members || []) {
    if (m.disabled) continue
    const who = { id: m.id, name: m.name }
    if (m.live?.startedAt) ev.push({ ...who, t: m.live.startedAt, kind: 'live', text: t('Training now · {0}', m.live.name) })
    if (m.lastWorkout) ev.push({ ...who, t: noon(m.lastWorkout), kind: 'workout', text: t('Finished a workout') })
    if (m.lastCheckin) ev.push({ ...who, t: noon(m.lastCheckin), kind: 'checkin', text: t('Filed a check-in') })
    if (m.lastDecision?.at) {
      const ok = m.lastDecision.status === 'accepted'
      ev.push({ ...who, t: Date.parse(m.lastDecision.at), kind: m.lastDecision.status, text: ok ? t('Accepted a program') : t('Declined a program') })
    }
    if (m.created) ev.push({ ...who, t: Date.parse(m.created), kind: 'joined', text: t('Joined') })
  }
  // A date from the future is a clock problem, not news; a day of slack covers timezones.
  return ev.filter(e => Number.isFinite(e.t) && e.t <= now + DAY).sort((a, b) => b.t - a.t).slice(0, limit)
}
