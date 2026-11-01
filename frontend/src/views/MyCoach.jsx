import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, fetchMyPhotos } from '../lib/api.js'
import { t, tp } from '../lib/i18n.js'
import { fmtDate, todayISO, isoOf } from '../lib/format.js'
import { isCheckinDue, checkinDayOf, scoreOf, QUESTIONS } from '../lib/checkins.js'
import { targetOf } from '../lib/nutrition.js'
import { photosByPeriod, photoSrc, PHOTOS_REACHABLE } from '../lib/photo.js'
import { pendingInvite, clearInvite } from '../lib/invite.js'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row } from '../components/ui.jsx'
import { TargetRows } from '../components/MacroRows.jsx'
import { openCoachOffer, checkinSheet } from '../sheets.jsx'
import { unreadCount } from '../lib/notes.js'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// A real <button>, not a div with role="button": that shape only fired on Enter, so a keyboard or
// switch-control user pressing Space on the focused card scrolled the page — and this is the one
// action on the screen. Nothing here needs a div; a button gets Space, Enter and focus for free.
//
// Exported because Home shows the same offers. One definition, so the two screens cannot drift
// into describing the same waiting program differently.
export const OfferCard = ({ offer }) => (
  <button className="card" style={{ borderColor: 'var(--acc)', marginBottom: 12, width: '100%', textAlign: 'left', display: 'block' }}
    onClick={() => openCoachOffer(offer)}>
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <div className="tt">{t('{0} sent you a program', offer.coachName)}</div>
        <div className="ss dim">{offer.note || t('Tap to review it.')}</div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  </button>
)

/**
 * The client's side of the relationship, which until now had no screen at all.
 *
 * Everything a coach does arrived somewhere else and unlabelled: a program offer was a card on
 * Home that disappeared the moment it was answered, check-ins were reachable only from a due-card
 * that vanished once filed, the photos a client sent could never be looked at again, and the
 * coach's name appeared on an inert Settings row. A client could not answer "who is my coach, what
 * am I on, and what have I sent them" from anywhere in the app.
 *
 * Translated, unlike every coach surface: this is the member's app.
 */
export default function MyCoach() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const assignments = useStore(s => s.assignments)
  const today = todayISO()

  const coachName = user?.coachName
  const offers = assignments || []

  if (!user) return <NoAccount />
  if (!coachName) return <NoCoach offers={offers} />

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}>
        <h1 style={{ margin: 0 }}>{t('Coach')}</h1>
        <div className="sub">{coachName}</div>
      </div>
    </div>

    {/* Said plainly, on the screen about them, rather than buried in Settings where it used to
        live. Somebody reading this person's training is a real privacy fact and the client should
        never have to find it out from somewhere else. */}
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <span className="lrow-i" style={{ background: 'var(--acc)', color: 'var(--on-acc)', width: 40, height: 40, fontSize: 18, fontWeight: 700 }}>
          {String(coachName).trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="tt">{coachName}</div>
          <div className="ss">{t('Can see your training and send you programs.')}</div>
        </div>
      </div>
    </div>

    {/* Every pending offer, not just the first. A coach can send two — a training block and a
        deload, say — and the old Home card showed assignments[0] and silently swallowed the rest. */}
    {offers.map(o => <OfferCard key={o.id} offer={o} />)}

    <CoachNotes coachName={coachName} S={S} />
    <CurrentProgram />
    <CheckIn S={S} today={today} />
    {PHOTOS_REACHABLE && <Photos userId={user.id} />}
    <Targets S={S} nav={nav} />
  </div>
}

/* ------------------------------------------------------------------ notes -- */

// What their coach wrote (CHW-340): replies to check-ins and comments on workouts, newest first,
// each with what it is about. Opening this screen reads them; the ones new on arrival keep their
// dot while it stays open, so the client can see which they had not read.
function CoachNotes({ coachName, S }) {
  const notes = useStore(s => s.notes)
  const [fresh, setFresh] = useState(() => new Set())
  useEffect(() => {
    if (!unreadCount(notes)) return
    setFresh(f => new Set([...f, ...notes.filter(n => !n.readAt).map(n => n.id)]))
    useStore.getState().readNotes()
  }, [notes])
  if (!notes?.length) return null
  const about = n => {
    if (n.refType === 'checkin') return t('On your check-in of {0}', fmtDate(n.refKey))
    const w = (S.workouts || []).find(x => x.id === n.refKey)
    return w ? t('On {0}, {1}', w.name, fmtDate(w.d)) : t('On a workout')
  }
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="tt" style={{ marginBottom: 6 }}>{t('From {0}', coachName)}</div>
    {notes.slice(0, 20).map(n => <div key={n.id} style={{ padding: '8px 0', borderTop: '1px solid var(--sep)' }}>
      <div className="row" style={{ gap: 6 }}>
        {fresh.has(n.id) && <span aria-label={t('New')} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--acc)', flex: 'none' }} />}
        <span className="dim small">{about(n)}</span>
      </div>
      <div className="small" style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{n.body}</div>
    </div>)}
  </div>
}

/* --------------------------------------------------------------- no coach -- */

function NoAccount() {
  return <div className="narrow">
    <div className="hdr"><h1 style={{ margin: 0 }}>{t('Coach')}</h1></div>
    <div className="empty">{t('Create a profile to train with a coach. Everything here stays on this device until you do.')}</div>
  </div>
}

/**
 * Someone training on their own — and the only place in the app where an existing account can
 * join a coach.
 *
 * Registration burns an invite as part of signing up, so before POST /api/invite/redeem the only
 * way onto a roster was to be new: a client who had been using the app for months and was handed
 * a link had to abandon their history and make a second profile.
 */
function NoCoach({ offers }) {
  const setUser = useStore(s => s.setUser)
  const toast = useUI(s => s.toast)
  // Prefilled when they arrived on a link while already signed in — the case the sign-in screen
  // never sees, because they never signed in.
  const [code, setCode] = useState(() => pendingInvite())
  const [busy, setBusy] = useState(false)

  const redeem = async () => {
    const c = code.trim()
    if (!c) { toast(t('Enter the code from your invite')); return }
    setBusy(true)
    try {
      const { user } = await api('/api/invite/redeem', { method: 'POST', body: JSON.stringify({ code: c }) })
      clearInvite()
      setUser(user)
      toast(t('You are now training with {0}', user.coachName))
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  return <div className="narrow">
    <div className="hdr"><h1 style={{ margin: 0 }}>{t('Coach')}</h1></div>

    {/* An offer can exist with no coach bound: an admin can assign one by hand without the
        invite flow. Shown first, because answering it is the thing to do. */}
    {offers.map(o => <OfferCard key={o.id} offer={o} />)}

    <div className="card">
      <div className="tt">{t('You’re training on your own')}</div>
      <div className="ss dim" style={{ marginTop: 4, lineHeight: 1.45 }}>
        {t('Everything works without a coach. If someone sent you an invite link, open it — or paste the code from it here.')}
      </div>
      <div style={{ height: 12 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div style={{ height: 10 }} />
      <Button variant="primary" disabled={busy || !code.trim()} onClick={redeem}>
        {busy ? t('Joining…') : t('Join my coach')}
      </Button>
    </div>
  </div>
}

/* ------------------------------------------------------------ the program -- */

function CurrentProgram() {
  const [rows, setRows] = useState(null)
  // Keyed on the pending count, not []. openCoachOffer resolves in a SHEET, which is a sibling of
  // the route — this screen never unmounts — so a one-shot fetch meant accepting the offer made
  // the card vanish while "Your program" went on saying "Nothing accepted yet" until you navigated
  // away and back. That is the exact sequence this screen exists to serve.
  const pendingCount = (useStore(s => s.assignments) || []).length
  useEffect(() => {
    // Not worth a toast if it fails: this is one card on a screen that still says everything
    // else, and an empty state reads the same as an old account with nothing decided.
    api('/api/assignments/history').then(d => setRows(d.assignments || [])).catch(() => setRows([]))
  }, [pendingCount])

  if (rows === null) return null
  const current = rows.find(a => a.status === 'accepted')
  if (!current && !rows.length) return null

  return <Section title={t('Your program')}>
    {current
      ? <Row icon="clipboard" iconTint="var(--acc)"
        title={current.name || t('Program from {0}', current.coachName)}
        subtitle={[
          current.routines ? tp(current.routines, '{0} routine', '{0} routines') : null,
          // isoOf, not a slice of the ISO string: decidedAt is the server's UTC instant, and
          // slicing it hands a client in UTC+13 yesterday's date and one in UTC-8 tomorrow's.
          // Every other date in the app is a local calendar day.
          current.decidedAt ? t('started {0}', fmtDate(isoOf(new Date(current.decidedAt)))) : null,
        ].filter(Boolean).join(' · ')} />
      : <Row icon="clipboard" iconTint="var(--grey)" title={t('Nothing accepted yet')}
        subtitle={t('Programs you accept show up here.')} />}
    {current?.note && <div className="lrow" style={{ alignItems: 'flex-start' }}>
      <div className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{current.note}</div>
    </div>}
  </Section>
}

/* ------------------------------------------------------------- check-ins --- */

function CheckIn({ S, today }) {
  const due = isCheckinDue(S, today)
  const day = checkinDayOf(S)
  const history = [...(S.checkins || [])].reverse().slice(0, 6)

  return <Section title={t('Weekly check-in')} footer={due ? undefined : t('Your coach sees these as soon as they sync.')}>
    {due
      ? <Row icon="clipboard" iconTint="var(--acc)" title={t('Due now')}
        subtitle={t('Five quick scales and anything your coach should know.')}
        accessory="chevron" onClick={() => checkinSheet()} />
      : <Row icon="calendar" iconTint="var(--grey)" title={t('Next one on {0}', t(DAY_NAMES[day]))}
        subtitle={t('You can also file one early.')} accessory="chevron" onClick={() => checkinSheet()} />}
    {history.map(c => {
      const score = scoreOf(c)
      return <div key={c.d} className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
        <div className="row between">
          <span className="small" style={{ fontWeight: 600 }}>{fmtDate(c.d, true)}</span>
          {/* null, not 0 — a form with no scales answered is empty, not a terrible week. */}
          {score != null && <span className="small" style={{ fontWeight: 700 }}>{score}<span className="dim">/5</span></span>}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {QUESTIONS.filter(q => c.answers?.[q.id]).map(q => <span key={q.id} className="dim" style={{ fontSize: '.7rem' }}>
            {t(q.label)} <b style={{ color: 'var(--label)' }}>{c.answers[q.id]}</b>
          </span>)}
        </div>
        {c.note && <div className="small dim" style={{ whiteSpace: 'pre-wrap' }}>{c.note}</div>}
      </div>
    })}
  </Section>
}

/* ---------------------------------------------------------------- photos -- */

function Photos({ userId }) {
  const [rows, setRows] = useState(null)
  const openSheet = useUI(s => s.openSheet)
  // Re-read when a check-in is filed, because the check-in sheet is opened FROM this screen and
  // uploads the photos as part of filing. A one-shot fetch meant the three angles someone had
  // just sent did not appear — and, on a first check-in, the whole section stayed hidden.
  const filed = (useStore(s => s.S.checkins) || []).length
  useEffect(() => { fetchMyPhotos().then(setRows).catch(() => setRows([])) }, [filed])

  const weeks = photosByPeriod(rows || [])
  if (rows === null || !weeks.length) return null

  return <Section title={t('Progress photos')} footer={t('Sent with your check-ins. Only you and your coach can see them.')}>
    {weeks.slice(0, 8).map(w => <div key={w.d} className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <span className="small" style={{ fontWeight: 600 }}>{fmtDate(w.d, true)}</span>
      <div className="row" style={{ gap: 6 }}>
        {w.photos.map(p => <img key={p.id} src={photoSrc(p, userId)} alt={p.pose || ''}
          loading="lazy"
          style={{ width: 72, height: 96, objectFit: 'cover', borderRadius: 'var(--r)', cursor: 'pointer' }}
          onClick={() => openSheet(() => <img src={photoSrc(p, userId)} alt={p.pose || ''}
            style={{ width: '100%', borderRadius: 'var(--r)' }} />)} />)}
      </div>
    </div>)}
  </Section>
}

/* --------------------------------------------------------------- targets -- */

function Targets({ S, nav }) {
  const target = targetOf(S)
  if (!target) return null
  return <Section title={t('Daily targets')} footer={t('Set by your coach. Tap to log what you have eaten.')}>
    <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <TargetRows target={target} />
    </div>
    <Row icon="flame" iconTint="var(--orange)" title={t('Nutrition')} accessory="chevron" onClick={() => nav('/nutrition')} />
  </Section>
}
