import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtVol, fmtDur, isoOf } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { adherenceBand, adherenceOf } from '../lib/adherence.js'
import { buildPlanBundle, buildProgramBundle } from '../lib/plan-share.js'
import { uid } from '../lib/format.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { StatsPanels } from './Stats.jsx'

// Coach dashboard: the members assigned to you, and sending them a program.
//
// English-only for the same reason as Admin.jsx — an operator surface, not part of the
// translated end-user experience. The member's side of this (the offer sheet) IS translated.
//
// Programs are authored in the ordinary Plan screen and then SAVED here as a named snapshot --
// a frozen copy of the routines you chose. That keeps one place to write routines (no second
// editor to keep working) while still separating client programming from personal training:
// once saved, changing your own Plan does not touch a program you already have in the library,
// and sending picks a program rather than shipping everything you happen to have.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

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
const ADH_TONE = { 'on-track': 'var(--green)', slipping: 'var(--yellow)', 'off-track': 'var(--red)' }
const adhPct = a => (a && a.rate != null ? Math.round(a.rate * 100) : null)

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
    <div className="dim" style={{ fontSize: '.66rem' }}>{res.days.length}d</div>
  </div>
}

export function AdherenceCard({ a }) {
  const pct = adhPct(a)
  // No plan means no adherence to report -- not 0%. Saying "0%" about someone who never set a
  // training week reads as a red flag on a person who has done nothing wrong.
  if (pct == null) return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ fontWeight: 600 }}>Adherence</div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>
      No training week set, so there is nothing to miss yet.
    </div>
  </div>
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row between">
      <span className="small" style={{ fontWeight: 600 }}>Adherence · last {a.days.length} days</span>
      <span style={{ fontWeight: 700, color: ADH_TONE[adherenceBand(a.rate)] }}>{pct}%</span>
    </div>
    <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>
      Trained {a.trained} of {a.planned} planned {a.planned === 1 ? 'day' : 'days'}
      {a.extra > 0 && ` · ${a.extra} unplanned`}
      {a.pending && ' · today still to come'}
    </div>
    {/* One cell per day, oldest first, so a run of misses reads as a block rather than a number
        that has quietly moved. Rest days stay visible but recede -- the gaps are the shape.
        maxWidth matters more than it looks: with flex alone a three-day window stretches to the
        same full-width bar as a month, and three green cells then read as a month of green. It
        never binds at a full window, so the usual case is unchanged. */}
    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
      {a.days.map(d => <div key={d.iso} title={`${d.iso} · ${d.state}`} style={{
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

const memberState = d => ({
  ...DEF,
  unit: d.unit, body: d.body, targetW: d.targetW, effort: d.effort, showRir: d.showRir,
  bodyweight: d.bodyweight || [],
  workouts: [...(d.workouts || [])].reverse(),
  routines: []
})

function MemberDetail({ id, close, pending, onChanged }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { api('/api/coach/member?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  // Only while it is still unanswered: once a member has acted on a program it is their data,
  // and unsending would mean reaching into their plan.
  const withdraw = a => api('/api/coach/assignments/withdraw', { method: 'POST', body: JSON.stringify({ id: a.id }) })
    .then(() => { toast('Program withdrawn'); close(); onChanged?.() })
    .catch(e => toast(e.message))
  return <>
    <h3 className="capitalize">{d.user.name}</h3>
    {(pending || []).length > 0 && <div className="card" style={{ marginBottom: 12 }}>
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
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    <AdherenceCard a={memberAdherence(d)} />
    {/* The same panels the member sees on their own Stats screen, against their state. readOnly
        hides the controls that write to or navigate the *coach's* data — logging a weigh-in, setting
        a goal, opening a workout sheet that reads from the coach's own store. */}
    <StatsPanels S={memberState(d)} readOnly />

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

function SendSheet({ members, close, program }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [picked, setPicked] = useState([])
  const [note, setNote] = useState('')
  const [schedule, setSchedule] = useState(false)
  const [busy, setBusy] = useState(false)

  // A saved program when one was chosen; otherwise the coach's current plan, which is what the
  // very first version always sent.
  const bundle = program ? program.bundle : buildPlanBundle(S, (user?.name || 'Coach') + '’s program')
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
    <h3>{program ? 'Send “' + program.name + '”' : 'Send your current plan'}</h3>
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

// Saving a program = snapshotting the routines you picked. Copies, not references: a program
// you saved last month must not change because you edited your own Plan this morning.
function SaveProgramSheet({ close }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.concat(id))

  const save = () => {
    if (!picked.length) { toast('Pick at least one routine'); return }
    const bundle = buildProgramBundle(S, picked, name.trim() || 'Program')
    useStore.getState().update(s => {
      s.programs = s.programs || []
      s.programs.push({ id: uid(), name: name.trim() || 'Program', created: new Date().toISOString(), bundle })
    })
    toast('Program saved')
    close()
  }

  const usable = (S.routines || []).filter(r => (r.ex || []).length)
  if (!usable.length) return <>
    <h3>Nothing to save yet</h3>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      Build the routines in your own Plan first, then come back and save the ones that make up this program.
    </div>
  </>

  return <>
    <h3>Save a program</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      This takes a copy of the routines you pick. Editing your own Plan later will not change it.
    </div>
    <input className="input" placeholder="Program name (e.g. Beginner Block A)" maxLength={40}
      value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 10 }} />
    <h4 className="sec">Routines to include</h4>
    <div className="list" style={{ gap: 0 }}>
      {usable.map(r => <label key={r.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{r.ex.length} exercises</div></div>
        <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
      </label>)}
    </div>
    <Button variant="primary" style={{ marginTop: 14 }} disabled={!picked.length} onClick={save}>
      {picked.length ? 'Save ' + picked.length + (picked.length === 1 ? ' routine' : ' routines') + ' as a program' : 'Pick at least one routine'}
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
  const programs = useStore(s => s.S.programs) || []

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
      <button className="iconbtn" onClick={() => nav('/you')} aria-label="Back"><Icon name="chevronLeft" /></button>
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
      <div className="row between"><h2 style={{ margin: 0 }}>Programs</h2>
        <Button variant="primary" size="sm" icon="plus"
          onClick={() => openSheet(close => <SaveProgramSheet close={close} />)}>Save a program</Button></div>
      <div className="small muted" style={{ margin: '6px 0 8px', lineHeight: 1.4 }}>
        Write the routines in your own Plan, save the ones that make up a program here, then send it.
        Members accept before anything is added to theirs.
      </div>
      {programs.map(p => <div key={p.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{p.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>
            {p.bundle.routines.length} {p.bundle.routines.length === 1 ? 'routine' : 'routines'} · saved {fmtDate(String(p.created).slice(0, 10))}</div></div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} disabled={!members?.length}
            onClick={() => openSheet(close => <SendSheet members={members || []} close={close} program={p} />)}>Send</button>
          <button className="iconbtn" aria-label="Delete program"
            onClick={() => useStore.getState().update(s => { s.programs = (s.programs || []).filter(x => x.id !== p.id) })}><Icon name="trash" /></button>
        </div>
      </div>)}
      {!programs.length && <div className="dim small">No saved programs yet.</div>}
      <div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" disabled={!members?.length}
        onClick={() => openSheet(close => <SendSheet members={members || []} close={close} />)}>Send my current plan instead</Button>
    </div>

    {live.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Training now</h2>
      {live.map(m => <div key={m.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openSheet(close => <MemberDetail id={m.id} close={close} pending={m.pending} onChanged={load} />)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{m.live.name} · ex {m.live.exIdx}/{m.live.exTotal} · {m.live.setsDone}/{m.live.setsTotal} sets</div></div>
        <span className="tag acc">{dur(Date.now() - m.live.startedAt)}</span>
      </div>)}
    </div>}

    <h4 className="sec">My members</h4>
    <div className="list">
      {(members || []).map(m => <div key={m.id} className="item" onClick={() => openSheet(close => <MemberDetail id={m.id} close={close} pending={m.pending} onChanged={load} />)}>
        <div className="grow">
          <div className="tt">
            {m.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{m.name}
            {/* Sending used to tell you nothing. Now the roster says whether they answered. */}
            {m.pending?.length > 0 && <span className="tag" style={{ marginLeft: 6 }}>program waiting</span>}
            {!m.pending?.length && m.lastDecision?.status === 'declined' && <span className="tag" style={{ marginLeft: 6, color: 'var(--yellow)' }}>declined</span>}
            {!m.pending?.length && m.lastDecision?.status === 'accepted' && <span className="tag acc" style={{ marginLeft: 6 }}>accepted</span>}
          </div>
          <div className="ss">{m.live ? 'training now · ' + m.live.name : m.workouts + ' workouts' + (m.lastWorkout ? ' · last ' + fmtDate(m.lastWorkout) : '') + ' · synced ' + rel(m.lastSync)}</div>
        </div>
        {/* Down the column this is the thing to scan: a workout count says how long someone has
            been here, not whether they are still turning up. Absent when they have no training
            week, rather than a 0% that would read as a problem with the member. */}
        <RosterAdherence parts={m.adherence} />
        <Icon name="chevronRight" className="chev" />
      </div>)}
      {members && !members.length && <div className="empty">No members assigned to you yet — an admin assigns them from the admin dashboard.</div>}
    </div>
  </div>
}
