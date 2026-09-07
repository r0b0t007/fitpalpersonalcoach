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
// Same normalisation the server clashes on (roomKey in domain.mjs): "Studio 1" and "studio  1"
// are one room there, so listing them as two chips each showing half that studio's timetable
// would contradict it. One chip per real room, labelled with the first spelling seen.
const roomKey = r => String(r || '').trim().toLowerCase().replace(/\s+/g, ' ')
const roomsOf = list => {
  const seen = new Map()
  for (const s of list || []) if (s.room && !seen.has(roomKey(s.room))) seen.set(roomKey(s.room), s.room)
  return [...seen.values()].sort()
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
      // Closes on success: the sheet captured the coach list when it opened, so leaving it up
      // after a change shows a stale roster — and there is nothing left to do here anyway.
      .then(() => { toast(coachId ? 'Coach assigned' : 'Coach cleared'); onChanged(); close() })
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
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({
          title: 'Disable ' + u.name + '?',
          message: 'They are signed out everywhere and can no longer sync or log in until re-enabled.'
            + (u.coach ? ' Members assigned to them are unassigned and their pending programs are withdrawn — re-enabling does not bring the roster back.' : ''),
          confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true)
        })}>
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

// A member joining has to end up on their own device anyway — passkeys can only be created there
// — so the useful thing to hand them is a link that carries the code, not sixteen hex characters
// to retype. `?invite=` rather than a hash route: the app is hash-routed and the query survives
// it untouched, with nothing new to register.
export const inviteLink = code => `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`

function InvitesCard({ invites, inviteOnly, reload }) {
  const toast = useUI(s => s.toast)
  const [note, setNote] = useState('')
  const copy = (text, said) => { navigator.clipboard?.writeText(text).catch(() => {}); toast(said) }
  // The server has always accepted a note; the client sent `{}` and never rendered one, which is
  // why three codes generated on Monday are an anonymous wall of hex by Wednesday.
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: JSON.stringify({ note: note.trim() }) })
    .then(({ invite }) => { copy(inviteLink(invite.code), 'Invite link copied · ' + invite.code); setNote(''); reload() })
    .catch(e => toast(e.message))
  const revoke = i => confirmSheet({
    title: 'Revoke this code?',
    message: (i.note ? `“${i.note}” — ` : '') + `${i.code} stops working immediately. If you already sent it out, whoever has it will not be able to join.`,
    confirmText: 'Revoke', danger: true,
    onConfirm: () => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code: i.code }) })
      .then(() => { toast('Code revoked'); reload() }).catch(e => toast(e.message))
  })
  const open = (invites || []).filter(i => !i.usedBy && !i.revoked)
  const used = (invites || []).filter(i => i.usedBy)
  const revoked = (invites || []).filter(i => !i.usedBy && i.revoked)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Invite codes</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">Generate</Button></div>
    <div className="small muted" style={{ margin: '6px 0 8px' }}>{open.length} unused · {used.length} redeemed{revoked.length ? ' · ' + revoked.length + ' revoked' : ''}</div>
    {/* Without this an admin can hand out codes on an open instance and never learn they do
        nothing — signup was never gated, and nothing in the UI said so. */}
    {inviteOnly === false && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 8, lineHeight: 1.4 }}>
      Signup is currently open to anyone with the address — codes are not required and not checked.
      Set <span style={{ fontFamily: 'monospace' }}>INVITE_ONLY=1</span> and restart to make these matter.
    </div>}
    <input className="input" placeholder="Who is this for? (optional)" maxLength={60}
      value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 10 }} />
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <div style={{ minWidth: 0 }}>
        {i.note && <div className="small" style={{ fontWeight: 600 }}>{i.note}</div>}
        <span className="dim" style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '.74rem', letterSpacing: '.06em' }}
          onClick={() => copy(i.code, 'Copied ' + i.code)}>{i.code}</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn" style={{ width: 'auto', padding: '4px 10px' }}
          onClick={() => copy(inviteLink(i.code), 'Invite link copied')}>Copy link</button>
        <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i)} aria-label="revoke"><Icon name="trash" /></button>
      </div>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || 'used'}</span>
    </div>)}
    {revoked.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem', textDecoration: 'line-through' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>{i.note || 'revoked'}</span>
    </div>)}
    {!open.length && !used.length && !revoked.length && <div className="dim small">No codes yet — generate one to invite someone.</div>}
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
      if (request.code) navigator.clipboard?.writeText(inviteLink(request.code)).catch(() => {})
      toast(approve ? 'Approved — link copied · ' + request.code + ' · send it to ' + request.name : 'Request rejected')
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
        <Button size="sm" onClick={() => confirmSheet({
          title: 'Reject ' + r.name + '?',
          message: 'This cannot be undone, and they are never told — so they will not know to ask again. If you are unsure, leave it pending.',
          confirmText: 'Reject', danger: true, onConfirm: () => decide(r.id, false)
        })}>Reject</Button>
      </div>
    </div>)}
    {!pending.length && <div className="dim small">No open requests.</div>}
    {decided.length > 0 && <>
      <h4 className="sec" style={{ margin: '14px 0 4px' }}>Decided</h4>
      {decided.map(r => <div key={r.id} className="row between" style={{ padding: '7px 2px', fontSize: '.8rem', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span>{r.name}</span> <span className="dim">· {r.phone}</span>
          {r.status === 'approved' && r.code && !r.redeemed && !r.codeDead && <div className="row" style={{ gap: 10, marginTop: 2 }}>
            <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}
              onClick={() => { navigator.clipboard?.writeText(inviteLink(r.code)).catch(() => {}); toast('Invite link copied') }}>{r.code}</span>
            {/* phone is requester-supplied text — reduce it to dialable characters so it can't
                smuggle ?body=… into the URI and rewrite the message the admin taps to send */}
            <a href={'sms:' + r.phone.replace(/[^\d+]/g, '') + '?body=' + encodeURIComponent('Join ' + BRAND + ': ' + inviteLink(r.code))}>text it to {r.name}</a>
          </div>}
          {/* Revoking the code used to leave this row still offering to text it. */}
          {r.status === 'approved' && r.codeDead && !r.redeemed &&
            <div className="dim" style={{ fontSize: '.72rem', marginTop: 2 }}>code revoked — generate a new invite if they still need one</div>}
        </div>
        <span className={'tag' + (r.redeemed || r.status === 'approved' ? ' acc' : '')}
          style={r.status === 'rejected' ? { color: 'var(--red)' } : null}>{r.redeemed ? 'joined' : r.status}</span>
      </div>)}
    </>}
  </div>
}

/* ---------- group sessions ---------- */
function SessionSheet({ session, close, reload, users, rooms }) {
  const toast = useUI(s => s.toast)
  const [f, setF] = useState(session
    ? { title: session.title, coach: session.coach || '', coachId: session.coachId || '', room: session.room || '', date: session.date, time: session.time, minutes: session.minutes, capacity: session.capacity || '', note: session.note || '', id: session.id }
    : { title: '', coach: '', coachId: '', room: '', date: todayISO(), time: '18:00', minutes: 60, capacity: '', note: '' })
  const [repeat, setRepeat] = useState(1)
  // Clashes come back from the server on an unconfirmed save; showing them turns the second
  // press into a deliberate override rather than a mystery.
  const [clashes, setClashes] = useState(null)
  const set = patch => setF(x => ({ ...x, ...patch, ...(patch.coachId !== undefined ? { coach: '' } : null) }))
  // The currently-assigned coach stays in the list even when disabled, marked as such: excluding
  // them made the picker read "no coach" for a class that has one, and the save then failed with
  // an error nothing on screen explained.
  const assigned = (users || []).find(u => u.id === f.coachId)
  const coaches = (users || []).filter(u => u.coach && !u.disabled)
    .concat(assigned && assigned.disabled ? [assigned] : [])

  const save = (series, confirm = false) => {
    if (!f.title.trim()) { toast('Enter a title'); return }
    api('/api/admin/sessions/save', { method: 'POST', body: JSON.stringify({ session: f, repeatWeeks: repeat, series, confirm }) })
      .then(r => {
        if (r.conflicts?.length) { setClashes({ list: r.conflicts, series }); return }
        close(); toast('Session saved'); reload()
      })
      .catch(e => toast(e.message))
  }
  // The reason members will read on the timetable, so it is asked for rather than borrowed from
  // the class note — cancelling a class noted "Bring a mat" used to tell everyone exactly that.
  const [cancelling, setCancelling] = useState(null)
  const doCancel = (series, reason) => api('/api/admin/sessions/cancel', { method: 'POST', body: JSON.stringify({ id: session.id, series, reason }) })
    .then(() => { close(); toast('Class cancelled'); reload() }).catch(e => toast(e.message))
  const restore = series => api('/api/admin/sessions/cancel', { method: 'POST', body: JSON.stringify({ id: session.id, series, restore: true }) })
    .then(() => { close(); toast('Class restored'); reload() }).catch(e => toast(e.message))
  const del = series => confirmSheet({
    title: series ? 'Delete this and all upcoming in the series?' : 'Delete this session?',
    message: 'It disappears from the calendar entirely, with no trace for members. To call off a class people were expecting, cancel it instead.',
    confirmText: 'Delete', danger: true,
    onConfirm: () => api('/api/admin/sessions/delete', { method: 'POST', body: JSON.stringify({ id: session.id, series }) })
      .then(() => { close(); toast('Session deleted'); reload() }).catch(e => toast(e.message))
  })

  if (cancelling) return <>
    <h3>{cancelling.series ? 'Cancel this and all upcoming?' : 'Cancel this class?'}</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      It stays on the timetable marked cancelled, so members who planned around it can see what happened. The coach is notified.
    </div>
    <input className="input" placeholder="Reason members will see (optional)" maxLength={120} autoFocus
      value={cancelling.reason} onChange={e => setCancelling(c => ({ ...c, reason: e.target.value }))} />
    <div style={{ height: 12 }} />
    <Button variant="danger" onClick={() => doCancel(cancelling.series, cancelling.reason.trim())}>
      {cancelling.series ? 'Cancel all upcoming' : 'Cancel this class'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setCancelling(null)}>Keep it</Button>
  </>

  if (clashes) return <>
    <h3>That slot is already taken</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      Nothing has been saved yet. Overlapping classes are sometimes deliberate, so this is a warning, not a rule.
    </div>
    <div className="list" style={{ gap: 0, marginBottom: 14 }}>
      {clashes.list.map(c => <div key={c.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{c.title}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>
            {fmtDate(c.date, true)} · {c.time} · {c.minutes} min{c.room ? ' · ' + c.room : ''}</div></div>
        <span className="tag" style={{ color: 'var(--yellow)' }}>{c.why === 'room' ? 'same room' : 'same coach'}</span>
      </div>)}
    </div>
    <Button variant="primary" onClick={() => save(clashes.series, true)}>Save anyway</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setClashes(null)}>Go back and change it</Button>
  </>

  return <>
    <h3>{session ? 'Edit session' : 'Add session'}</h3>
    {session?.cancelled && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10, lineHeight: 1.4 }}>
      This class is cancelled{session.cancelReason ? ' — “' + session.cancelReason + '”' : ''}.
    </div>}
    <input className="input" placeholder="Title (e.g. Spinning)" maxLength={60} value={f.title} onChange={e => set({ title: e.target.value })} />
    <div style={{ height: 10 }} />
    <input className="input" list="room-list" placeholder="Room (e.g. Studio 1)" maxLength={40} value={f.room} onChange={e => set({ room: e.target.value })} />
    <datalist id="room-list">{(rooms || []).map(r => <option key={r} value={r} />)}</datalist>
    <div style={{ height: 10 }} />
    <select className="input" value={f.coachId || (f.coach ? '__guest' : '')} onChange={e => {
      if (e.target.value === '__guest') setF(x => ({ ...x, coachId: '', coach: x.coach || ' ' }))
      else set({ coachId: e.target.value })
    }}>
      <option value="">— no coach —</option>
      {coaches.map(c => <option key={c.id} value={c.id}>{c.name}{c.disabled ? ' (disabled)' : ''}</option>)}
      <option value="__guest">Guest instructor…</option>
    </select>
    {!f.coachId && f.coach !== '' && <>
      <div style={{ height: 8 }} />
      <input className="input" placeholder="Guest instructor name" maxLength={40} value={f.coach} onChange={e => setF(x => ({ ...x, coach: e.target.value, coachId: '' }))} />
    </>}
    {!coaches.length && <div className="dim small" style={{ marginTop: 6 }}>No coaches yet — make someone a coach to assign classes to them.</div>}
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
      <Button onClick={() => save(true)}>Save for this + upcoming in series</Button>
      <div className="dim small" style={{ marginTop: 6, lineHeight: 1.4 }}>
        Moving the date this way shifts every later class in the series by the same number of days — that is how you move a weekly class to a different weekday.
      </div></>}
    {session && <><div style={{ height: 12 }} />
      {session.cancelled
        ? <>
          <Button variant="primary" onClick={() => restore(false)}>Restore this class</Button>
          {session.seriesId && <><div style={{ height: 8 }} />
            <Button onClick={() => restore(true)}>Restore this + upcoming in series</Button></>}
        </>
        : <>
          <Button variant="danger" onClick={() => setCancelling({ series: false, reason: '' })}>Cancel class</Button>
          {session.seriesId && <><div style={{ height: 8 }} />
            <Button variant="danger" onClick={() => setCancelling({ series: true, reason: '' })}>Cancel this + upcoming in series</Button></>}
        </>}
      <h4 className="sec">Remove entirely</h4>
      <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.4 }}>
        Deleting leaves no trace for members. Use it for something added by mistake, not for a class people were expecting.
      </div>
      <Button variant="ghost" className="dim" onClick={() => del(false)}>Delete</Button>
      {session.seriesId && <><div style={{ height: 8 }} />
        <Button variant="ghost" className="dim" onClick={() => del(true)}>Delete this + upcoming in series</Button></>}</>}
  </>
}

function SessionsCard({ sessions, users, reload }) {
  const openSheet = useUI(s => s.openSheet)
  const [room, setRoom] = useState('')
  const [showAll, setShowAll] = useState(false)
  const rooms = roomsOf(sessions)
  // Mirrors the server: someone disabled or no longer a coach is not shown as teaching, so the
  // row falls through to "coach unavailable" and the admin can reassign.
  const coachName = s => {
    if (!s.coachId) return s.coach || ''
    const c = (users || []).find(u => u.id === s.coachId)
    return c && c.coach && !c.disabled ? c.name : ''
  }
  const edit = s => openSheet(close => <SessionSheet session={s} close={close} reload={reload} users={users} rooms={rooms} />)
  const upcoming = (sessions || [])
    .filter(s => s.date >= todayISO())
    .filter(s => !room || roomKey(s.room) === roomKey(room))
  // A 26-week series of two weekly classes overflowed the old flat cap of 30 immediately, so the
  // list stays short by default and opens on request rather than silently truncating.
  const shown = showAll ? upcoming : upcoming.slice(0, 30)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Group sessions</h2>
      <Button variant="primary" size="sm" icon="plus" onClick={() => edit(null)}>Add session</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{upcoming.length} upcoming · visible to everyone, guests included</div>
    {rooms.length > 1 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      <span className={'tag' + (room ? '' : ' acc')} onClick={() => setRoom('')} style={{ cursor: 'pointer' }}>All rooms</span>
      {rooms.map(r => <span key={r} className={'tag' + (roomKey(room) === roomKey(r) ? ' acc' : '')} onClick={() => setRoom(r)} style={{ cursor: 'pointer' }}>{r}</span>)}
    </div>}
    {shown.map(s => <div key={s.id} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)', opacity: s.cancelled ? .55 : 1 }} onClick={() => edit(s)}>
      <div><div className="small" style={{ fontWeight: 600, textDecoration: s.cancelled ? 'line-through' : 'none' }}>
        {s.title}
        {s.seriesId && <span className="tag" style={{ marginInlineStart: 6 }}>weekly</span>}
        {s.cancelled && <span className="tag" style={{ marginInlineStart: 6, color: 'var(--red)' }}>cancelled</span>}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(s.date, true)} · {s.time} · {s.minutes} min{s.room ? ' · ' + s.room : ''}{coachName(s) ? ' · ' + coachName(s) : (s.coachId ? ' · coach unavailable' : '')}{s.capacity ? ' · ' + s.capacity + ' spots' : ''}</div></div>
      <Icon name="chevronRight" className="chev" />
    </div>)}
    {upcoming.length > shown.length && <div className="small acc" style={{ padding: '9px 2px', cursor: 'pointer' }} onClick={() => setShowAll(true)}>
      Show all {upcoming.length}</div>}
    {!upcoming.length && <div className="dim small">{room ? 'Nothing scheduled in ' + room + '.' : "Nothing scheduled — add the week's classes."}</div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  // null = not known yet. Starting at false made the "signup is open to anyone" warning flash on
  // every load of an invite-only instance, and stay up for good if the fetch that sets it failed.
  const [inviteOnly, setInviteOnly] = useState(null)
  const [requests, setRequests] = useState(null)
  const [reqEnabled, setReqEnabled] = useState(false)
  const [sessions, setSessions] = useState(null)

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || 'Failed to load'))
  const loadInvites = () => api('/api/admin/invites')
    .then(d => { setInvites(d.invites); if (d.invite_only !== undefined) setInviteOnly(d.invite_only) })
    .catch(() => {})
  const loadRequests = () => api('/api/admin/requests').then(d => { setRequests(d.requests); setReqEnabled(d.request_access) }).catch(() => {})
  const loadSessions = () => api('/api/sessions').then(d => setSessions(d.sessions)).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadRequests(); loadSessions(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} users={users} onChanged={loadUsers} close={close} />)
  // A member whose coach was disabled keeps pointing at them until an admin reassigns, and the
  // dropdown drops disabled coaches from its options — so name the state rather than showing a
  // row that silently reads as unassigned.
  const coachNameOf = u => {
    if (!u.coachId) return ''
    const c = (users || []).find(x => x.id === u.coachId)
    return c ? (c.disabled ? 'coach ' + c.name + ' (disabled)' : 'coach ' + c.name) : 'coach removed'
  }
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/you')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 8 }}><h1 style={{ margin: 0 }}>Admin</h1>
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

    <SessionsCard sessions={sessions} users={users} reload={loadSessions} />

    <InvitesCard invites={invites} inviteOnly={inviteOnly} reload={() => { loadInvites(); loadRequests() }} />

    <h4 className="sec">Users</h4>
    <div className="list">
      {[...(users || [])].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
        .map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginInlineStart: 4 }}>admin</span>}{u.coach && !u.admin && <span className="tag acc" style={{ marginInlineStart: 4 }}>coach</span>}{u.disabled && <span className="tag" style={{ marginInlineStart: 4, color: 'var(--red)' }}>off</span>}</div>
          <div className="ss">{[
            u.live ? 'training now · ' + u.live.name
              : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · synced ' + rel(u.lastSync),
            coachNameOf(u)
          ].filter(Boolean).join(' · ')}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">No users yet.</div>}
    </div>
  </div>
}
