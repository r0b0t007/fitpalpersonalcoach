import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtVol, fmtDur } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { buildPlanBundle } from '../lib/plan-share.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Coach dashboard: the members assigned to you, and sending them a program.
//
// English-only for the same reason as Admin.jsx — an operator surface, not part of the
// translated end-user experience. The member's side of this (the offer sheet) IS translated.
//
// There is no program builder here on purpose. A coach programs in the ordinary Plan screen and
// sends that, which is exactly what buildPlanBundle already produces for "share a plan with a
// friend". A separate library would be a second place to author routines and a second thing to
// keep working.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function MemberDetail({ id, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { api('/api/coach/member?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  return <>
    <h3 className="capitalize">{d.user.name}</h3>
    <div className="tiles" style={{ textAlign: 'left', margin: '10px 0' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    <h4 className="sec">Their routines</h4>
    {d.routines.length
      ? <div className="list" style={{ gap: 0 }}>
        {d.routines.map(r => <div key={r.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small" style={{ fontWeight: 600 }}>{r.name}</span>
          <span className="dim small">{r.count} exercises</span>
        </div>)}
      </div>
      : <div className="empty small">No routines yet.</div>}
    <h4 className="sec">Workout history</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">No workouts logged.</div>}
  </>
}

function SendSheet({ members, close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [picked, setPicked] = useState([])
  const [note, setNote] = useState('')
  const [schedule, setSchedule] = useState(false)
  const [busy, setBusy] = useState(false)

  const bundle = buildPlanBundle(S, (user?.name || 'Coach') + '’s program')
  const exCount = bundle.routines.reduce((n, r) => n + r.ex.length, 0)
  const days = Object.keys(bundle.week || {}).length
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.concat(id))

  const send = () => {
    setBusy(true)
    api('/api/coach/assign', {
      method: 'POST',
      body: JSON.stringify({ memberIds: picked, bundle, note, schedule })
    })
      .then(({ sent }) => { toast('Sent to ' + sent + (sent === 1 ? ' member' : ' members')); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }

  if (!bundle.routines.length) return <>
    <h3>Nothing to send yet</h3>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      Build the program in your own Plan first — the routines you have there are what gets sent.
    </div>
  </>

  return <>
    <h3>Send your plan</h3>
    <div className="muted small" style={{ marginBottom: 4 }}>
      {bundle.routines.length} {bundle.routines.length === 1 ? 'routine' : 'routines'} · {exCount} exercises
      {days ? ' · scheduled on ' + days + (days === 1 ? ' day' : ' days') : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      Each member is asked to accept before anything is added. Their own routines are never changed or removed.
    </div>

    <input className="input" placeholder="Note (optional) — what this block is for" maxLength={280}
      value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 10 }} />

    <label className="row between" style={{ padding: '8px 2px', marginBottom: 6 }}>
      <span className="small">Also set their weekly schedule</span>
      <input type="checkbox" checked={schedule} onChange={e => setSchedule(e.target.checked)} />
    </label>
    {schedule && <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
      This replaces which routine sits on each weekday for them. Leave it off to add the routines and let them slot them in.
    </div>}

    <h4 className="sec">Send to</h4>
    {members.length ? <div className="list" style={{ gap: 0 }}>
      {members.map(m => <label key={m.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{m.workouts} workouts · synced {rel(m.lastSync)}</div></div>
        <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
      </label>)}
    </div> : <div className="empty small">No members assigned to you yet.</div>}

    <Button variant="primary" style={{ marginTop: 14 }} disabled={!picked.length || busy} onClick={send}>
      {busy ? 'Sending…' : picked.length ? 'Send to ' + picked.length + (picked.length === 1 ? ' member' : ' members') : 'Pick at least one member'}
    </Button>
  </>
}

export default function Coach() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [members, setMembers] = useState(null)
  const [classes, setClasses] = useState(null)

  const load = () => api('/api/coach/members').then(d => setMembers(d.members)).catch(e => toast(e.message || 'Failed to load'))
  const loadClasses = () => api('/api/coach/sessions').then(d => setClasses(d.sessions)).catch(() => setClasses([]))
  useEffect(() => {
    if (!user?.coach) return
    load(); loadClasses()
    const iv = setInterval(load, 15000)   // keeps "training now" live, same as Admin
    return () => clearInterval(iv)
  }, [])
  if (!user?.coach) return null
  const nextClasses = (classes || []).slice(0, 8)

  const live = (members || []).filter(m => m.live)
  const active = (members || []).filter(m => m.lastSync && Date.now() - m.lastSync < 7 * 86400000).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Coach</h1>
        <div className="sub">{members ? members.length + (members.length === 1 ? ' member' : ' members') + ' · ' + active + ' active this week' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={load} aria-label="refresh">↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Members</div><div className="v">{members ? members.length : '—'}</div></div>
      <div className="tile"><div className="l">Training now</div><div className="v" style={{ color: live.length ? 'var(--acc)' : undefined }}>{members ? live.length : '—'}</div></div>
      <div className="tile"><div className="l">Active 7d</div><div className="v">{members ? active : '—'}</div></div>
    </div>

    {/* Classes first: an instructor opening the app wants to know what they are teaching today,
        before anything about programming. Admin owns the timetable, so this is read-only. */}
    <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>My classes</h2>
      {classes == null ? <div className="dim small">Loading…</div>
        : nextClasses.length ? nextClasses.map(s => <div key={s.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', opacity: s.cancelled ? .55 : 1 }}>
          <div><div className="small" style={{ fontWeight: 600, textDecoration: s.cancelled ? 'line-through' : 'none' }}>{s.title}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(s.date, true)} · {s.time} · {s.minutes} min{s.room ? ' · ' + s.room : ''}</div></div>
          {s.cancelled && <span className="tag" style={{ color: 'var(--red)' }}>cancelled</span>}
        </div>)
        : <div className="dim small">No classes assigned to you. An admin sets the timetable.</div>}
    </div>

    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Send a program</h2>
        <Button variant="primary" size="sm" icon="share" disabled={!members?.length}
          onClick={() => openSheet(close => <SendSheet members={members || []} close={close} />)}>Send my plan</Button></div>
      <div className="small muted" style={{ marginTop: 6, lineHeight: 1.4 }}>
        Build it in your own Plan, then send it. Members accept before anything is added to theirs.
      </div>
    </div>

    {live.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Training now</h2>
      {live.map(m => <div key={m.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openSheet(close => <MemberDetail id={m.id} close={close} />)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{m.live.name} · ex {m.live.exIdx}/{m.live.exTotal} · {m.live.setsDone}/{m.live.setsTotal} sets</div></div>
        <span className="tag acc">{dur(Date.now() - m.live.startedAt)}</span>
      </div>)}
    </div>}

    <h4 className="sec">My members</h4>
    <div className="list">
      {(members || []).map(m => <div key={m.id} className="item" onClick={() => openSheet(close => <MemberDetail id={m.id} close={close} />)}>
        <div className="grow">
          <div className="tt">{m.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{m.name}</div>
          <div className="ss">{m.live ? 'training now · ' + m.live.name : m.workouts + ' workouts' + (m.lastWorkout ? ' · last ' + fmtDate(m.lastWorkout) : '') + ' · synced ' + rel(m.lastSync)}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
      {members && !members.length && <div className="empty">No members assigned to you yet — an admin assigns them from the admin dashboard.</div>}
    </div>
  </div>
}
