import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fetchPrograms } from '../../lib/programs.js'
import { fmtDate, fmtVol, fmtDur, DAYN } from '../../lib/format.js'
import { t, tp } from '../../lib/i18n.js'
import { workoutVolume, setsDone } from '../../lib/history.js'
import Icon from '../../components/Icon.jsx'
import { Button, Segmented } from '../../components/ui.jsx'
import { StatsPanels } from '../Stats.jsx'
import { AdherenceCard, CheckinsCard, PhotosCard, memberAdherence, memberState } from './parts.jsx'
import { SendSheet } from './sheets.jsx'
import { confirmSheet } from '../../sheets.jsx'

// One client, as a page rather than the sheet it used to be: Today's attention rows deep-link
// here, the browser's back button has to mean something, and a coach reads this screen for
// longer than a sheet is comfortable. The segments split what used to be one very long scroll.
// A function, so the labels are read in the current language at render.
const TABS = () => [
  // "Plan", not "Program": the tab shows the client's own routines and week, what their app calls
  // Plan, and French "Programme" is wider than a fifth of a phone (CHW-209).
  { value: 'overview', label: t('Overview') }, { value: 'program', label: t('Plan') },
  { value: 'checkins', label: t('Check-ins') }, { value: 'photos', label: t('Photos') }, { value: 'stats', label: t('Stats') },
]
// A logged workout's one-line summary, shared by the overview and the history list.
const workoutLine = w => fmtDate(w.d, true) + ' · ' + fmtDur((w.end || w.start) - w.start) + ' · ' + tp(setsDone(w), '{0} set', '{0} sets')
  + (w.prs?.length ? ' · ' + tp(w.prs.length, '{0} PR', '{0} PRs') : '')
// Monday-first, the way a training week reads; getDay() indexes like everywhere else.
const WEEK = [1, 2, 3, 4, 5, 6, 0]

// Which program to send, when the coach has a library. Sending their current Plan stays on the
// list because that is what the button did before there was a library, and it is still how a
// coach who writes a block and sends it the same day works.
export function ProgramPicker({ programs, close, onPick }) {
  return <>
    <h3>{t('Send a program')}</h3>
    <div className="list" style={{ rowGap: 0 }}>
      {programs.map(p => <button key={p.id} className="row between" style={{ width: '100%', textAlign: 'left', padding: '11px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => onPick(p)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{p.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{tp(p.bundle.routines.length, '{0} routine', '{0} routines')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </button>)}
      <button className="row between" style={{ width: '100%', textAlign: 'left', padding: '11px 2px' }} onClick={() => onPick(null)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{t('My current plan')}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{t('Whatever is in your own Plan right now')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </button>
    </div>
  </>
}

export default function ClientDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  // The library lives on the server now (lib/programs.js). Reading S.programs here is what made
  // "Send a program" fall through to the coach's current plan without ever offering the picker.
  const [programs, setPrograms] = useState([])
  const [d, setD] = useState(null)
  const [roster, setRoster] = useState(null)
  const [tab, setTab] = useState('overview')

  const load = () => {
    api('/api/coach/member?id=' + encodeURIComponent(id)).then(setD).catch(e => { toast(e.message); nav('/clients') })
    // The roster row carries what the member payload does not: this coach's pending offers.
    api('/api/coach/members').then(r => setRoster(r.members || [])).catch(() => {})
  }
  useEffect(load, [id])
  useEffect(() => { fetchPrograms().then(d => setPrograms(d.programs)).catch(() => {}) }, [])

  if (!d) return <div className="narrow"><div className="hdr"><h1>…</h1></div><div className="muted small">{t('Loading…')}</div></div>
  const row = (roster || []).find(m => m.id === id)
  const pending = row?.pending || []
  // max, not the last element — the same reduce the server's roster field uses. The list is kept
  // in date order by upsertCheckin, but a coach-side judgement should not depend on that holding:
  // if it ever slipped, this tile and Today's "check-in overdue" row would disagree about one
  // client in front of the coach.
  const lastCheckin = (d.checkins || []).reduce((max, c) => (c && c.d > max ? c.d : max), '') || null
  const byId = Object.fromEntries((d.routines || []).map(r => [r.id, r]))
  const week = d.week || {}

  // Only while it is still unanswered: once a member has acted on a program it is their data,
  // and unsending would mean reaching into their plan.
  const withdraw = a => api('/api/coach/assignments/withdraw', { method: 'POST', body: JSON.stringify({ id: a.id }) })
    .then(() => { toast(t('Program withdrawn')); load() })
    .catch(e => toast(e.message))
  // The sheet needs the roster row for everyone it lists, and the request for it can still be in
  // flight (or have failed) while this page is already drawn from its own payload. Falling back to
  // a row built from what we do have keeps the sheet honest: it would otherwise say "no clients yet"
  // underneath a primary button reading "Send to 1 client".
  const sendTo = roster?.length ? roster.filter(m => !m.disabled) : [{ id, name: d.user.name, workouts: d.workouts.length, lastSync: d.lastSync }]
  const open = program => openSheet(close => <SendSheet members={sendTo} close={close} program={program} preselect={[id]} onSent={load} />)
  // "Send a program" has to be able to send a saved one, not silently always the coach's current
  // Plan. With a library, pick from it first; with none, there is nothing to pick between.
  const send = () => (programs.length
    ? openSheet(close => <ProgramPicker programs={programs} close={close} onPick={p => { close(); open(p) }} />)
    : open(null))
  // Release, not disable (CHW-320): the client stops being this coach's, which frees a seat on the
  // plan (the cap counts User::activeClientsOf, by coach), and their account, log and own plan stay
  // theirs. Disabling an account is the operator's, and would lock them out of their own data.
  // The server withdraws this coach's unanswered offers to them in the same step.
  const release = () => confirmSheet({
    title: t('Release {0}?', d.user.name),
    message: t('They stop being your client, which frees a seat on your plan. Their account and training log stay theirs, and programs they have not answered yet are withdrawn. To coach them again, send them a new invite.'),
    confirmText: t('Release'), danger: true,
    onConfirm: () => api('/api/coach/member/release', { method: 'POST', body: JSON.stringify({ id }) })
      .then(() => { toast(t('{0} is no longer your client', d.user.name)); nav('/clients') })
      .catch(e => toast(e.message)),
  })

  return <div className="narrow">
    {/* As on Today: the button keeps its label on one line and drops under the name when both do
        not fit ("Envoyer un programme" beside a two-word name is wider than a phone). */}
    <div className="hdr" style={{ flexWrap: 'wrap' }}>
      <button className="iconbtn" onClick={() => nav('/clients')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: '1 1 0', minWidth: 'min-content', marginLeft: 8 }}><h1 className="capitalize name" style={{ margin: 0 }}>{d.user.name}</h1>
        <div className="sub">{d.user.created ? t('Client since {0}', fmtDate(String(d.user.created).slice(0, 10))) : ''}{row?.live ? ' · ' + t('training now') : ''}</div></div>
      <div style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}><Button variant="tinted" size="sm" icon="clipboard" onClick={send}>{t('Send a program')}</Button></div>
    </div>

    <Segmented className="seg-range" options={TABS()} value={tab} onChange={setTab} />

    {tab === 'overview' && <>
      {pending.length > 0 && <div className="card" style={{ marginBottom: 12 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{t('Waiting for them to answer')}</div>
        {pending.map(a => <div key={a.id} className="row between" style={{ padding: '7px 2px' }}>
          <span className="dim small">{t('Sent {0}', fmtDate(String(a.created).slice(0, 10)))}</span>
          <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => withdraw(a)}>{t('Withdraw')}</button>
        </div>)}
      </div>}
      <div className="tiles" style={{ textAlign: 'left', margin: '10px 0' }}>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
        <div className="tile"><div className="l">{t('Last check-in')}</div><div className="v" style={{ fontSize: '.95rem' }}>{lastCheckin ? fmtDate(lastCheckin) : t('none')}</div></div>
      </div>
      <AdherenceCard a={memberAdherence(d)} />
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{t('Last workouts')}</div>
        {d.workouts.length ? d.workouts.slice(0, 5).map(w => <div key={w.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{workoutLine(w)}</div></div>
          <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
        </div>) : <div className="dim small">{t('No workouts logged.')}</div>}
      </div>
      <Button variant="danger" onClick={release}>{t('Release client')}</Button>
    </>}

    {tab === 'program' && <>
      <h4 className="sec">{t('Their routines')}</h4>
      {d.routines.length
        ? <div className="list" style={{ rowGap: 0 }}>
          {d.routines.map(r => <div key={r.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
            <span className="small" style={{ fontWeight: 600 }}>{r.name}</span>
            <span className="dim small">{tp(r.count, '{0} exercise', '{0} exercises')}</span>
          </div>)}
        </div>
        : <div className="empty small">{t('No routines yet — send them a program.')}</div>}
      <h4 className="sec">{t('Their week')}</h4>
      <div className="list" style={{ rowGap: 0 }}>
        {WEEK.map(dow => {
          const ids = [].concat(week[dow] || []).filter(rid => byId[rid])
          return <div key={dow} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
            <span className="small" style={{ fontWeight: 600 }}>{t(DAYN[dow])}</span>
            <span className={'small' + (ids.length ? '' : ' dim')}>{ids.length ? ids.map(rid => byId[rid].name).join(' + ') : t('rest')}</span>
          </div>
        })}
      </div>
      <h4 className="sec">{t('Workout history')}</h4>
      {d.workouts.length ? <div className="list" style={{ rowGap: 0 }}>
        {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{workoutLine(w)}</div></div>
          <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
        </div>)}
      </div> : <div className="empty small">{t('No workouts logged.')}</div>}
    </>}

    {tab === 'checkins' && <CheckinsCard checkins={d.checkins} />}

    {/* Server-owned, so it comes from the payload's own `photos` field rather than from
        memberState() — readState never sees these, by design. */}
    {tab === 'photos' && <PhotosCard photos={d.photos} memberId={d.user.id} />}

    {/* The same panels the member sees on their own Stats screen, against their state. readOnly
        hides the controls that write to or navigate the *coach's* data. */}
    {tab === 'stats' && <StatsPanels S={memberState(d)} readOnly />}
  </div>
}
