import { useState } from 'react'
import { DEF } from '../../store/useStore.js'
import { fmtDate, isoOf } from '../../lib/format.js'
import { adherenceBand, adherenceOf } from '../../lib/adherence.js'
import { QUESTIONS, scoreOf } from '../../lib/checkins.js'
import { POSES, photoSrc, photosByPeriod, PHOTOS_REACHABLE } from '../../lib/photo.js'
import { t, tp } from '../../lib/i18n.js'
import NoteThread from './NoteThread.jsx'

// The read-only pieces of a client's page — adherence, check-ins, photos — and the two shape
// adapters (memberAdherence, memberState) that turn the coach payloads into what those pieces
// and StatsPanels expect. Moved out of the old single-file dashboard when it split into
// Today / Clients / client detail; the bodies are unchanged.

export const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
export const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? t('{0}m', m) : t('{0}h{1}m', Math.floor(m / 60), m % 60) }
// A photo's pose id ('front') as the label the client picked it under, in the coach's language.
const poseLabel = id => { const p = POSES.find(x => x.id === id); return p ? t(p.label) : id }
// What each adherence cell means, for its tooltip.
const DAY_STATE = { trained: () => t('Trained'), missed: () => t('Missed'), extra: () => t('Unplanned'), pending: () => t('Still to come'), rest: () => t('Rest') }

// GET /api/coach/member returns a deliberately narrow subset of a member's state. Widen it back
// to DEF's shape so a panel reaching for a field the coach payload omits degrades instead of
// throwing, and fix the two shapes that differ from the client's own store:
//   · workouts arrive newest-first from the API; S.workouts is oldest-first everywhere else, and
//     every chart would read backwards without this.
//   · routines are stripped to { id, name, count } with no `ex`, so they are withheld rather than
//     handed to code that expects a real routine.
// Adherence: did they show up on the days their plan says they train? The only number here a
// coach cannot get from the member's own screens, and the one that goes wrong quietly — someone
// drifting from four sessions a week to two still has a chart full of workouts.
//
// The band is the judgement and lives in lib/adherence.js with a test on its thresholds; this is
// only the paint. Rounding for display happens after banding, so a 79.6% never shows as "80%"
// in green — the colour and the number always agree.
export const ADH_TONE = { 'on-track': 'var(--green)', slipping: 'var(--yellow)', 'off-track': 'var(--red)' }
export const adhPct = a => (a && a.rate != null ? Math.round(a.rate * 100) : null)

// The roster sends the four fields already; an opened member sends the plan plus full history,
// so the same shape is rebuilt from the richer payload rather than scored differently.
export const memberAdherence = (d, todayIso = isoOf(new Date())) => adherenceOf({
  week: d.week,
  dayPlan: d.dayPlan,
  // `count` is the routine's exercise count in this payload. Empty routines are dropped for the
  // same reason the roster drops them server-side: a day nobody could have started is not a day
  // anybody missed.
  routineIds: (d.routines || []).filter(r => r.count > 0).map(r => r.id),
  trainedDays: (d.workouts || []).map(w => w.d),
  created: d.user?.created || null
}, todayIso)

// `parts` is the raw four-field shape off the wire, not a scored result -- the roster scores it
// here so the API never has to know what adherence means.
export function RosterAdherence({ parts, todayIso = isoOf(new Date()) }) {
  const res = parts && adherenceOf(parts, todayIso)
  const pct = adhPct(res)
  if (pct == null) return null
  // res.days.length, not the window constant: a member who joined three days ago is scored over
  // three days, and captioning that "28d" would sell a single Monday as a month of turning up.
  return <div style={{ textAlign: 'right', marginRight: 6, lineHeight: 1.1 }}>
    <div style={{ fontWeight: 700, color: ADH_TONE[adherenceBand(res.rate)] }}>{pct}%</div>
    <div className="dim" style={{ fontSize: '.66rem' }}>{t('{0}d', res.days.length)}</div>
  </div>
}

// What the training data cannot say. Adherence says whether they turned up and the tape says
// what changed; only this says they have been sleeping five hours and work is brutal — which is
// what a coach actually changes the plan for.
//
// Newest first and the note given room, because the note is the point. The scales are context
// for it, not a dashboard: five numbers a week is not a dataset, it is a conversation opener.
// With `memberId`, each check-in carries the coach's replies and the box to add one (CHW-340).
export function CheckinsCard({ checkins, notes, memberId, onNotes }) {
  const list = [...(checkins || [])].reverse().slice(0, 8)
  if (!list.length) return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600 }}>{t('Check-ins')}</div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>{t('None filed yet.')}</div>
  </div>
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('Check-ins')}</div>
    {list.map(c => {
      const score = scoreOf(c)
      return <div key={c.d} style={{ padding: '8px 0', borderBottom: '1px solid var(--sep)' }}>
        <div className="row between">
          <span className="dim small">{fmtDate(c.d, true)}</span>
          {/* null, not 0 — a form with no scales answered is empty, not a terrible week. */}
          {score != null && <span className="small" style={{ fontWeight: 700 }}>{score}<span className="dim">/5</span></span>}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 3 }}>
          {QUESTIONS.filter(q => c.answers?.[q.id]).map(q => <span key={q.id} className="dim" style={{ fontSize: '.7rem' }}>
            {t(q.label)} <b style={{ color: 'var(--label)' }}>{c.answers[q.id]}</b>
          </span>)}
        </div>
        {c.note && <div className="small" style={{ marginTop: 5, whiteSpace: 'pre-wrap' }}>{c.note}</div>}
        {memberId && <NoteThread notes={notes} refType="checkin" refKey={c.d} memberId={memberId} onNotes={onNotes} />}
      </div>
    })}
  </div>
}

// Progress photos — the one thing on this screen that is neither a number nor a chart, and for
// most clients the reason the numbers get looked at. Newest week first, the three angles in a
// row, tap one to open it full width.
//
// Read-only by construction rather than by a flag. There is nothing here that writes anywhere:
// no store, no PUT, not even a delete. That is the same property `readOnly` buys StatsPanels,
// arrived at by having nothing to gate instead of by gating it — which is why this card is NOT
// routed through memberState/StatsPanels. Those panels are shared with the member's own Stats
// screen, DEF has no `photos` key, and widening a shared prop-driven component to carry one
// member's private images is the wrong direction entirely.
//
// The metadata arrives with the rest of GET /api/coach/member; each image is then its own
// request against GET /api/media/photo, which re-checks canCoachMember. So a coach who loses a
// member loses the images at that moment, without this screen having to know anything about it.
export function PhotosCard({ photos, memberId }) {
  const [open, setOpen] = useState(null)
  const weeks = photosByPeriod(photos)
  // The paired mobile build cannot render these — an <img> resolves its src against the Capacitor
  // WebView's own origin and carries no Authorization header, so every tile would be a permanent
  // grey box. lib/photo.js argues it at length; sheets.jsx hides the member's half for the same
  // reason. Said out loud rather than hidden, because the coach's half is not a feature they can
  // do without knowing about: silence here is indistinguishable from "she sent none", and that
  // is a wrong answer to the one question this card exists to answer.
  if (!PHOTOS_REACHABLE) return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600 }}>{t('Progress photos')}</div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2, lineHeight: 1.45 }}>
      {weeks.length ? tp(weeks.length, '{0} week filed.', '{0} weeks filed.') + ' ' : ''}
      {t('Photos only open in the browser dashboard, not in the app build.')}
    </div>
  </div>
  if (!weeks.length) return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600 }}>{t('Progress photos')}</div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>{t('None sent yet.')}</div>
  </div>
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('Progress photos')}</div>
    {weeks.slice(0, 8).map(wk => <div key={wk.d} style={{ padding: '6px 0', borderBottom: '1px solid var(--sep)' }}>
      <div className="dim small">{fmtDate(wk.d, true)}</div>
      <div className="row" style={{ gap: 6, marginTop: 4, alignItems: 'flex-start' }}>
        {wk.photos.map(p => <div key={p.id} style={{ flex: 1, maxWidth: 110 }}>
          {/* loading="lazy" is not decoration here: a year of check-ins is 150 authenticated
              requests, and the coach is looking at the top two weeks. */}
          <img src={photoSrc(p, memberId)} alt={poseLabel(p.pose)} loading="lazy"
            onClick={() => setOpen(open === p.id ? null : p.id)}
            style={{
              width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block',
              borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer'
            }} />
          <div className="dim" style={{ fontSize: '.66rem', textAlign: 'center', marginTop: 2 }}>{poseLabel(p.pose)}</div>
        </div>)}
      </div>
      {/* Full width rather than a lightbox: the useful comparison is against the same angle in
          an earlier week, which is one scroll away, not a modal that hides it. */}
      {wk.photos.some(p => p.id === open) && <img src={photoSrc(wk.photos.find(p => p.id === open), memberId)}
        alt="" onClick={() => setOpen(null)}
        style={{ width: '100%', borderRadius: 10, margin: '8px 0', display: 'block', cursor: 'pointer' }} />}
    </div>)}
  </div>
}

export function AdherenceCard({ a }) {
  const pct = adhPct(a)
  // No plan means no adherence to report -- not 0%. Saying "0%" about someone who never set a
  // training week reads as a red flag on a person who has done nothing wrong.
  if (pct == null) return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600 }}>{t('Adherence')}</div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>
      {t('No training week set, so there is nothing to miss yet.')}
    </div>
  </div>
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row between">
      <span className="small" style={{ fontWeight: 600 }}>{tp(a.days.length, 'Adherence · last {0} day', 'Adherence · last {0} days')}</span>
      <span style={{ fontWeight: 700, color: ADH_TONE[adherenceBand(a.rate)] }}>{pct}%</span>
    </div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>
      {tp(a.planned, 'Trained {1} of {0} planned day', 'Trained {1} of {0} planned days', a.trained)}
      {a.extra > 0 && ' · ' + tp(a.extra, '{0} unplanned day', '{0} unplanned days')}
      {a.pending && ' · ' + t('today still to come')}
    </div>
    {/* One cell per day, oldest first, so a run of misses reads as a block rather than a number
        that has quietly moved. Rest days stay visible but recede -- the gaps are the shape.
        maxWidth matters more than it looks: with flex alone a three-day window stretches to the
        same full-width bar as a month, and three green cells then read as a month of green. It
        never binds at a full window, so the usual case is unchanged. */}
    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
      {a.days.map(d => <div key={d.iso} title={`${d.iso} · ${DAY_STATE[d.state]?.() || d.state}`} style={{
        flex: 1, maxWidth: 14, height: 14, borderRadius: 2,
        background: d.state === 'trained' ? 'var(--green)'
          : d.state === 'missed' ? 'var(--red)'
            : d.state === 'extra' ? 'var(--teal)'
              : d.state === 'pending' ? 'var(--sep)' : 'var(--surface-2)',
        opacity: d.state === 'rest' ? .45 : 1
      }} />)}
    </div>
  </div>
}

// Exported only so parts.stats.test.jsx can assert its key set against the local mirror it tests
// the transform through. That mirror silently fell five fields behind this and nothing failed, so
// the parity check is the thing that stops it happening again — a comment cannot fail CI.
export const memberState = d => ({
  ...DEF,
  unit: d.unit, body: d.body, targetW: d.targetW, effort: d.effort, showRir: d.showRir,
  bodyweight: d.bodyweight || [],
  measurements: d.measurements || [],
  checkins: d.checkins || [],
  checkinDay: d.checkinDay ?? null,
  // Intake and the targets this coach set. Nothing else was needed: the Stats panel that draws
  // them is prop-driven, so widening the payload is the whole coach-side implementation.
  meals: d.meals || [],
  mealDays: d.mealDays || {},
  nutriTarget: d.nutriTarget ?? null,
  workouts: [...(d.workouts || [])].reverse(),
  routines: []
})
