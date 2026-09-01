import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, todayISO } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import { BRAND } from '../lib/brand.js'
import Icon from '../components/Icon.jsx'
import { Button, Stepper } from '../components/ui.jsx'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Deliberately English-only — it isn't part of the translated end-user surface, so it stays
// out of the per-language string packs.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function UserDetail({ id, users, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? 'User disabled' : 'User enabled'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const setCoach = coach =>
    api('/api/admin/user/coach', { method: 'POST', body: JSON.stringify({ id: u.id, coach }) })
      .then(() => { toast(coach ? 'Now a coach' : 'Coach role removed'); load(); onChanged() })
      .catch(e => toast(e.message))
  const assignCoach = coachId =>
    api('/api/admin/user/assign-coach', { method: 'POST', body: JSON.stringify({ id: u.id, coachId }) })
      .then(() => { toast(coachId ? 'Coach assigned' : 'Coach cleared'); load(); onChanged() })
      .catch(e => toast(e.message))
  // Admins are coaches implicitly, so the toggle is about the explicit flag only — otherwise it
  // would read as "on" for an admin and turning it off would appear to do nothing.
  const coaches = (users || []).filter(c => c.coach && c.id !== u.id && !c.disabled)
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">admin</span>}
      {u.coach && !u.admin && <span className="tag acc">coach</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>disabled</span>}
      {u.invitedBy && <span className="tag">invite {u.invitedBy}</span>}
      <span className="tag">joined {u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: 'Disable ' + u.name + '?', message: 'They are signed out everywhere and can no longer sync or log in until re-enabled.', confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? 'Enable account' : 'Disable account'}</button>}
    <h4 className="sec">Coaching</h4>
    {u.admin
      ? <div className="dim small" style={{ marginBottom: 10 }}>Admins can coach anyone — no assignment needed.</div>
      : <>
        <button className={'btn ' + (u.ownCoachFlag ? '' : 'primary')} style={{ marginBottom: 8 }}
          onClick={() => u.ownCoachFlag
            ? confirmSheet({
              title: 'Remove coach role from ' + u.name + '?',
              message: 'Members assigned to them are unassigned, and they lose access to those members immediately.',
              confirmText: 'Remove', danger: true, onConfirm: () => setCoach(false)
            })
            : setCoach(true)}>
          {u.ownCoachFlag ? 'Remove coach role' : 'Make a coach'}</button>
        <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
          A coach builds programs and sends them to their own members, and can see those members’ training. They cannot manage invites, access requests or accounts.
        </div>
      </>}
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="small">Their coach</span>
      <select className="input" style={{ width: 'auto', minWidth: 140 }} value={u.coachId || ''}
        onChange={e => assignCoach(e.target.value)}>
        <option value="">— none —</option>
        {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
    {!coaches.length && <div className="dim small" style={{ marginBottom: 8 }}>No coaches yet — make someone a coach first.</div>}

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

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast('Code ' + invite.code + ' created & copied'); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast('Code revoked'); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Invite codes</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">Generate</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} unused · {used.length} redeemed</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast('Copied ' + i.code) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || 'used'}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">No codes yet — generate one to invite someone.</div>}
  </div>
}

// Membership requests from the sign-in screen (REQUEST_ACCESS). Approval mints an invite code —
// but the app never contacts the requester, so the card frames the code as a handoff: copy it or
// text it to the number they left. "joined" = the code was redeemed at registration.
function RequestsCard({ requests, reload }) {
  const toast = useUI(s => s.toast)
  const pending = requests.filter(r => r.status === 'pending')
  const decided = requests.filter(r => r.status !== 'pending')
  const decide = (id, approve) => api('/api/admin/requests/decide', { method: 'POST', body: JSON.stringify({ id, approve }) })
    .then(({ request }) => {
      if (request.code) navigator.clipboard?.writeText(request.code).catch(() => {})
      toast(approve ? 'Approved — code ' + request.code + ' copied. Send it to ' + request.name + '.' : 'Request rejected')
      reload()
    }).catch(e => toast(e.message))
  const clearAll = () => confirmSheet({
    title: 'Clear all pending requests?', message: 'Removes every undecided request in one go — useful after a spam wave. Decided history stays.',
    confirmText: 'Clear all', danger: true,
    onConfirm: () => api('/api/admin/requests/clear', { method: 'POST', body: '{}' }).then(reload).catch(e => toast(e.message))
  })
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Access requests</h2>
      {pending.length > 1 && <Button size="sm" icon="trash" onClick={clearAll}>Clear pending</Button>}</div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{pending.length} pending</div>
    {pending.map(r => <div key={r.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 8 }}>
      <div style={{ minWidth: 0 }}><div className="small" style={{ fontWeight: 600 }}>{r.name}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{r.phone}{r.note ? ' · ' + r.note : ''} · {fmtDate(r.created.slice(0, 10))}</div></div>
      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
        <Button variant="primary" size="sm" onClick={() => decide(r.id, true)}>Approve</Button>
        <Button size="sm" onClick={() => decide(r.id, false)}>Reject</Button>
      </div>
    </div>)}
    {!pending.length && <div className="dim small">No open requests.</div>}
    {decided.length > 0 && <>
      <h4 className="sec" style={{ margin: '14px 0 4px' }}>Decided</h4>
      {decided.map(r => <div key={r.id} className="row between" style={{ padding: '7px 2px', fontSize: '.8rem', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span>{r.name}</span> <span className="dim">· {r.phone}</span>
          {r.status === 'approved' && r.code && !r.redeemed && <div className="row" style={{ gap: 10, marginTop: 2 }}>
            <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}
              onClick={() => { navigator.clipboard?.writeText(r.code).catch(() => {}); toast('Copied ' + r.code) }}>{r.code}</span>
            {/* phone is requester-supplied text — reduce it to dialable characters so it can't
                smuggle ?body=… into the URI and rewrite the message the admin taps to send */}
            <a href={'sms:' + r.phone.replace(/[^\d+]/g, '') + '?body=' + encodeURIComponent('Your ' + BRAND + ' invite code: ' + r.code)}>text it to {r.name}</a>
          </div>}
        </div>
        <span className={'tag' + (r.redeemed || r.status === 'approved' ? ' acc' : '')}
          style={r.status === 'rejected' ? { color: 'var(--red)' } : null}>{r.redeemed ? 'joined' : r.status}</span>
      </div>)}
    </>}
  </div>
}

/* ---------- group sessions ---------- */
function SessionSheet({ session, close, reload }) {
  const toast = useUI(s => s.toast)
  const [f, setF] = useState(session
    ? { title: session.title, coach: session.coach || '', date: session.date, time: session.time, minutes: session.minutes, capacity: session.capacity || '', note: session.note || '', id: session.id }
    : { title: '', coach: '', date: todayISO(), time: '18:00', minutes: 60, capacity: '', note: '' })
  const [repeat, setRepeat] = useState(1)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const save = series => {
    if (!f.title.trim()) { toast('Enter a title'); return }
    api('/api/admin/sessions/save', { method: 'POST', body: JSON.stringify({ session: f, repeatWeeks: repeat, series }) })
      .then(() => { close(); toast('Session saved'); reload() }).catch(e => toast(e.message))
  }
  const del = series => confirmSheet({
    title: series ? 'Delete this and all upcoming in the series?' : 'Delete this session?',
    message: 'It disappears from the calendar for everyone.', confirmText: 'Delete', danger: true,
    onConfirm: () => api('/api/admin/sessions/delete', { method: 'POST', body: JSON.stringify({ id: session.id, series }) })
      .then(() => { close(); toast('Session deleted'); reload() }).catch(e => toast(e.message))
  })
  return <>
    <h3>{session ? 'Edit session' : 'Add session'}</h3>
    <input className="input" placeholder="Title (e.g. Spinning)" maxLength={60} value={f.title} onChange={e => set({ title: e.target.value })} />
    <div style={{ height: 10 }} />
    <input className="input" placeholder="Coach" maxLength={40} value={f.coach} onChange={e => set({ coach: e.target.value })} />
    <div style={{ height: 10 }} />
    <div className="row" style={{ gap: 10 }}>
      <input type="date" className="input" style={{ flex: 1 }} value={f.date} onChange={e => set({ date: e.target.value })} />
      <input type="time" className="input timef" style={{ flex: 1 }} value={f.time} onChange={e => set({ time: e.target.value })} />
    </div>
    <div style={{ height: 10 }} />
    <div className="row between" style={{ padding: '4px 2px' }}>
      <span className="small">Duration</span>
      <Stepper value={f.minutes} step={5} decimal={false} unit="min" onChange={v => set({ minutes: Math.max(5, Math.min(240, v)) })} />
    </div>
    <div className="row between" style={{ padding: '4px 2px' }}>
      <span className="small">Spots (0 = unlimited)</span>
      <Stepper value={+f.capacity || 0} step={1} decimal={false} onChange={v => set({ capacity: Math.max(0, Math.min(500, v)) })} />
    </div>
    {!session && <div className="row between" style={{ padding: '4px 2px' }}>
      <span className="small">Repeat weekly ×</span>
      <Stepper value={repeat} step={1} decimal={false} onChange={v => setRepeat(Math.max(1, Math.min(26, v)))} />
    </div>}
    <div style={{ height: 10 }} />
    <input className="input" placeholder="Note (optional)" maxLength={200} value={f.note} onChange={e => set({ note: e.target.value })} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => save(false)}>{session ? 'Save' : repeat > 1 ? 'Add ' + repeat + ' sessions' : 'Add session'}</Button>
    {session?.seriesId && <><div style={{ height: 8 }} />
      <Button onClick={() => save(true)}>Save for this + upcoming in series</Button></>}
    {session && <><div style={{ height: 8 }} />
      <Button variant="danger" onClick={() => del(false)}>Delete</Button>
      {session.seriesId && <><div style={{ height: 8 }} />
        <Button variant="danger" onClick={() => del(true)}>Delete this + upcoming in series</Button></>}</>}
  </>
}

function SessionsCard({ sessions, reload }) {
  const openSheet = useUI(s => s.openSheet)
  const edit = s => openSheet(close => <SessionSheet session={s} close={close} reload={reload} />)
  const upcoming = (sessions || []).filter(s => s.date >= todayISO())
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Group sessions</h2>
      <Button variant="primary" size="sm" icon="plus" onClick={() => edit(null)}>Add session</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{upcoming.length} upcoming · visible to everyone, guests included</div>
    {upcoming.slice(0, 30).map(s => <div key={s.id} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => edit(s)}>
      <div><div className="small" style={{ fontWeight: 600 }}>{s.title}{s.seriesId && <span className="tag" style={{ marginLeft: 6 }}>weekly</span>}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(s.date, true)} · {s.time} · {s.minutes} min{s.coach ? ' · ' + s.coach : ''}{s.capacity ? ' · ' + s.capacity + ' spots' : ''}</div></div>
      <Icon name="chevronRight" className="chev" />
    </div>)}
    {!upcoming.length && <div className="dim small">Nothing scheduled — add the week's classes.</div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [requests, setRequests] = useState(null)
  const [reqEnabled, setReqEnabled] = useState(false)
  const [sessions, setSessions] = useState(null)

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || 'Failed to load'))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadRequests = () => api('/api/admin/requests').then(d => { setRequests(d.requests); setReqEnabled(d.request_access) }).catch(() => {})
  const loadSessions = () => api('/api/sessions').then(d => setSessions(d.sessions)).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadRequests(); loadSessions(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} users={users} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Admin</h1>
        <div className="sub">{users ? users.length + ' users · ' + activeCount + ' active this week' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); loadRequests(); loadSessions() }} aria-label="refresh">↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Users</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">Training now</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">Active 7d</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">Disabled</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Training now</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · ex {u.live.exIdx}/{u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} sets</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    {/* hidden entirely when REQUEST_ACCESS is off and no old requests linger */}
    {requests && (reqEnabled || requests.length > 0) &&
      <RequestsCard requests={requests} reload={() => { loadRequests(); loadInvites() }} />}

    <SessionsCard sessions={sessions} reload={loadSessions} />

    <InvitesCard invites={invites} reload={loadInvites} />

    <h4 className="sec">Users</h4>
    <div className="list">
      {(users || []).map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>admin</span>}{u.coach && !u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>coach</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>off</span>}</div>
          <div className="ss">{u.live ? 'training now · ' + u.live.name : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · synced ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">No users yet.</div>}
    </div>
  </div>
}
