import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate, fmtVol, fmtDur, DAYN } from '../../lib/format.js'
import { workoutVolume, setsDone } from '../../lib/history.js'
import Icon from '../../components/Icon.jsx'
import { Button, Segmented } from '../../components/ui.jsx'
import { StatsPanels } from '../Stats.jsx'
import { AdherenceCard, CheckinsCard, PhotosCard, memberAdherence, memberState } from './parts.jsx'
import { SendSheet } from './sheets.jsx'

// One client, as a page rather than the sheet it used to be: Today's attention rows deep-link
// here, the browser's back button has to mean something, and a coach reads this screen for
// longer than a sheet is comfortable. The segments split what used to be one very long scroll.
const TABS = [
  { value: 'overview', label: 'Overview' }, { value: 'program', label: 'Program' },
  { value: 'checkins', label: 'Check-ins' }, { value: 'photos', label: 'Photos' }, { value: 'stats', label: 'Stats' },
]
// Monday-first, the way a training week reads; getDay() indexes like everywhere else.
const WEEK = [1, 2, 3, 4, 5, 6, 0]

export default function ClientDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [roster, setRoster] = useState([])
  const [tab, setTab] = useState('overview')

  const load = () => {
    api('/api/coach/member?id=' + encodeURIComponent(id)).then(setD).catch(e => { toast(e.message); nav('/clients') })
    // The roster row carries what the member payload does not: this coach's pending offers.
    api('/api/coach/members').then(r => setRoster(r.members || [])).catch(() => {})
  }
  useEffect(load, [id])

  if (!d) return <div className="narrow"><div className="hdr"><h1>…</h1></div><div className="muted small">Loading…</div></div>
  const row = roster.find(m => m.id === id)
  const pending = row?.pending || []
  const lastCheckin = d.checkins?.length ? d.checkins[d.checkins.length - 1].d : null
  const byId = Object.fromEntries((d.routines || []).map(r => [r.id, r]))
  const week = d.week || {}

  // Only while it is still unanswered: once a member has acted on a program it is their data,
  // and unsending would mean reaching into their plan.
  const withdraw = a => api('/api/coach/assignments/withdraw', { method: 'POST', body: JSON.stringify({ id: a.id }) })
    .then(() => { toast('Program withdrawn'); load() })
    .catch(e => toast(e.message))
  const send = () => openSheet(close => <SendSheet members={roster.filter(m => !m.disabled)} close={close} preselect={[id]} onSent={load} />)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/clients')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 className="capitalize" style={{ margin: 0 }}>{d.user.name}</h1>
        <div className="sub">{d.user.created ? 'Client since ' + fmtDate(String(d.user.created).slice(0, 10)) : ''}{row?.live ? ' · training now' : ''}</div></div>
      <Button variant="tinted" size="sm" icon="clipboard" onClick={send}>Send a program</Button>
    </div>

    <Segmented className="seg-range" options={TABS} value={tab} onChange={setTab} />

    {tab === 'overview' && <>
      {pending.length > 0 && <div className="card" style={{ marginBottom: 12 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Waiting for them to answer</div>
        {pending.map(a => <div key={a.id} className="row between" style={{ padding: '7px 2px' }}>
          <span className="dim small">Sent {fmtDate(String(a.created).slice(0, 10))}</span>
          <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => withdraw(a)}>Withdraw</button>
        </div>)}
      </div>}
      <div className="tiles" style={{ textAlign: 'left', margin: '10px 0' }}>
        <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
        <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
        <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
        <div className="tile"><div className="l">Last check-in</div><div className="v" style={{ fontSize: '.95rem' }}>{lastCheckin ? fmtDate(lastCheckin) : 'none'}</div></div>
      </div>
      <AdherenceCard a={memberAdherence(d)} />
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Last workouts</div>
        {d.workouts.length ? d.workouts.slice(0, 5).map(w => <div key={w.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
          <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
        </div>) : <div className="dim small">No workouts logged.</div>}
      </div>
    </>}

    {tab === 'program' && <>
      <h4 className="sec">Their routines</h4>
      {d.routines.length
        ? <div className="list" style={{ rowGap: 0 }}>
          {d.routines.map(r => <div key={r.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
            <span className="small" style={{ fontWeight: 600 }}>{r.name}</span>
            <span className="dim small">{r.count} exercises</span>
          </div>)}
        </div>
        : <div className="empty small">No routines yet — send them a program.</div>}
      <h4 className="sec">Their week</h4>
      <div className="list" style={{ rowGap: 0 }}>
        {WEEK.map(dow => {
          const ids = [].concat(week[dow] || []).filter(rid => byId[rid])
          return <div key={dow} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
            <span className="small" style={{ fontWeight: 600 }}>{DAYN[dow]}</span>
            <span className={'small' + (ids.length ? '' : ' dim')}>{ids.length ? ids.map(rid => byId[rid].name).join(' + ') : 'rest'}</span>
          </div>
        })}
      </div>
      <h4 className="sec">Workout history</h4>
      {d.workouts.length ? <div className="list" style={{ rowGap: 0 }}>
        {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
          <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
        </div>)}
      </div> : <div className="empty small">No workouts logged.</div>}
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
