import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate, fmtNum } from '../../lib/format.js'
import { auditLine, auditCat, fmtWhen } from '../../lib/audit.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { confirmSheet } from '../../sheets.jsx'
import { rel } from './parts.jsx'
import { t, tp } from '../../lib/i18n.js'
// .adm-pill lives here. Imported explicitly rather than relying on Admin.jsx still importing it —
// which is why nothing lost its styling when P6 deleted that page.
import '../../admin.css'

/* The two operator jobs a single coach still has, taken out of the gym dashboard they were buried
 * in. Everything else on that page — classes, the timetable, access requests, assigning members to
 * one of several coaches — is about running a club, and this fork has one coach.
 *
 * Both screens talk to /api/admin/*, so both are for whoever runs the instance. CoachAccount only
 * shows the door when user.admin, and these check again: a route reached by typing the URL should
 * not render a screen whose every request comes back 403.
 */
// Whether this person runs the instance, and a redirect for when they do not. Returned rather
// than only rendered, because the SCREEN must not fetch either: AdminOnly renders null for a plain
// coach, but a sibling useEffect in the parent still ran — the URL fired an /api/admin/users that
// answered 403, toasted "forbidden" at them, and wrote a "Blocked from the admin dashboard" line
// into the log on the way past. That is exactly the permission error the redirect exists to avoid.
function useAdminOnly() {
  const nav = useNavigate()
  const isAdmin = !!useStore(s => s.user?.admin)
  useEffect(() => { if (!isAdmin) nav('/account', { replace: true }) }, [isAdmin])
  return isAdmin
}

function AdminOnly({ title, children }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  if (!user?.admin) return null
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/account')} aria-label={t('Account')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{title}</h1></div>
    </div>
    {children}
  </div>
}
/* ---------------------------------------------------------------- accounts -- */

export function AccountSheet({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const me = useStore(s => s.user)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user

  const setDisabled = disabled =>
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('Account disabled') : t('Account enabled')); onChanged(); close() })
      .catch(e => toast(e.message))

  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.id === me?.id && <span className="tag acc">{t('you')}</span>}
      {u.admin && u.id !== me?.id && <span className="tag acc">{t('admin')}</span>}
      {u.coach && !u.admin && <span className="tag acc">{t('coach')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>

    {/* Their training is on the client's own page, not here. This screen is about whether an
        account can sign in at all — the workout list that used to sit under these tiles is the
        same data Clients → someone → Overview already shows, in a place that knows whose it is. */}
    {/* `=== me.id`, not merely "has a coach": an admin can still assign a member to one of several
        coaches from the legacy page, and telling them to look under Clients for somebody who is
        not theirs sends them to a list that person is not on. */}
    {u.coachId === me?.id && <div className="dim small" style={{ margin: '12px 0 0', lineHeight: 1.45 }}>
      {t('One of your clients. Their training, check-ins and programs are on their page under Clients.')}
    </div>}

    {/* Not offered for your own account: disabling yourself signs you out of the screen you are
        standing on, with nobody left who can turn it back on. */}
    {/* The server refuses to disable any admin (server.js), so the button is hidden for all of
        them — not only for the viewer. */}
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false) : confirmSheet({
        title: t('Disable {0}?', u.name),
        message: u.coach
          ? t('They are signed out everywhere and cannot sign in or sync until you enable them again. Anyone they coach is unassigned and their pending programs are withdrawn — enabling does not bring that back.')
          : t('They are signed out everywhere and cannot sign in or sync until you enable them again.'),
        confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true),
      })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    {u.admin && <div className="dim small" style={{ marginTop: 12 }}>
      {u.id === me?.id
        ? t('This is you. Disabling it would sign you out with nobody able to undo it.')
        : t('This account runs the instance and cannot be disabled from here.')}
    </div>}
  </>
}

export function BusinessAccounts() {
  const isAdmin = useAdminOnly()
  const me = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)

  const load = () => api('/api/admin/users').then(d => setUsers(d.users)).catch(e => { toast(e.message || t('Failed to load')); setUsers(false) })
  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  const list = Array.isArray(users) ? users : []
  const disabledCount = list.filter(u => u.disabled).length

  return <AdminOnly title={t('Accounts')}>
    <p className="sect-f" style={{ marginTop: -6 }}>
      {t('Every profile on this instance, including people who train here on their own and are not your clients. Nothing here shows anyone’s training beyond counts.')}
    </p>
    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Profiles')}</div><div className="v">{users ? list.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>
    <div className="list">
      {[...list].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
        .map(u => <button key={u.id} className="item" style={u.disabled ? { opacity: .55 } : null}
          onClick={() => openSheet(close => <AccountSheet id={u.id} onChanged={load} close={close} />)}>
          <div className="grow">
            <div className="tt">{u.name}
              {u.id === me?.id && <span className="tag acc" style={{ marginLeft: 4 }}>{t('you')}</span>}
              {u.admin && u.id !== me?.id && <span className="tag acc" style={{ marginLeft: 4 }}>{t('admin')}</span>}
              {u.coach && !u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>{t('coach')}</span>}
              {u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('disabled')}</span>}</div>
            <div className="ss">{tp(u.workouts, '{0} workout', '{0} workouts')} · {t('synced {0}', rel(u.lastSync))}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </button>)}
      {users === false && <div className="empty">{t('Could not reach the server. Nothing has been lost — try again in a moment.')}</div>}
      {Array.isArray(users) && !list.length && <div className="empty">{t('No profiles yet.')}</div>}
    </div>
  </AdminOnly>
}

/* ------------------------------------------------------------ activity log -- */

export function BusinessActivity() {
  const isAdmin = useAdminOnly()
  const toast = useUI(s => s.toast)
  const [meta, setMeta] = useState(null)      // last response minus the rows: total, retention, …
  const [rows, setRows] = useState([])
  const [cat, setCat] = useState('')

  const load = (c, before) => api('/api/admin/audit?limit=50&cat=' + c + (before ? '&before=' + before : ''))
    .then(r => { setMeta(r); setRows(x => (before ? x.concat(r.events) : r.events)) })
    .catch(e => toast(e.message))
  const pick = c => { setCat(c); setRows([]); setMeta(null); load(c) }
  useEffect(() => { if (isAdmin) load(cat) }, [isAdmin])

  const clear = () => confirmSheet({
    title: t('Clear the activity log?'),
    message: t('Every recorded event is deleted. The clear itself is logged, so the gap stays visible.'),
    confirmText: t('Clear'), danger: true,
    onConfirm: () => api('/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast(t('Activity log cleared')); pick(cat) }).catch(e => toast(e.message)),
  })

  return <AdminOnly title={t('Activity log')}>
    {meta && !meta.enabled
      ? <div className="empty">{t('The activity log is switched off on this server (AUDIT_LOG=0). Nothing is being recorded.')}</div>
      : <>
        <p className="sect-f" style={{ marginTop: -6 }}>
          {t('Who signed in, what failed, and what changed.')}
          {meta && [
            tp(meta.total, '{1} event recorded.', '{1} events recorded.', fmtNum(meta.total)),
            meta.retention.days ? tp(meta.retention.days, 'Each event is kept for {0} day.', 'Each event is kept for {0} days.') : '',
            meta.ip_mode === 'off' ? t('IP addresses are not recorded.') : '',
          ].map(s => s && ' ' + s)}
        </p>
        <div className="chips" style={{ marginBottom: 10 }}>
          {[['', t('All')], ['auth', t('Sign-ins')], ['coach', t('Coaching')], ['admin', t('Account changes')], ['fail', t('Failed')]].map(([v, l]) =>
            <button key={v} className={'chip nocap' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{l}</button>)}
        </div>
        {rows.map(e => {
          const line = auditLine(e)
          return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
            <div className="grow">
              <div className="small" style={{ fontWeight: 600 }}>{line.title}
                {/* A red pill, not a red row: twenty fumbled Face IDs in a row should not read as
                    an incident. */}
                {!e.ok && <span className="adm-pill bad" style={{ marginLeft: 6 }}>{t('failed')}</span>}
                {auditCat(e.ev) === 'admin' && <span className="adm-pill acc" style={{ marginLeft: 6 }}>{t('account')}</span>}</div>
              {line.sub && <div className="dim" style={{ fontSize: '.72rem' }}>{line.sub}</div>}
            </div>
            <span className="small muted" style={{ flex: 'none', marginLeft: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
          </div>
        })}
        {meta && !rows.length && <div className="empty">{t('Nothing logged yet.')}</div>}
        {meta?.nextBefore && <div style={{ marginTop: 10 }}>
          <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>{t('Show more')}</Button></div>}
        {meta && !!rows.length && <div style={{ marginTop: 16 }}>
          <Button variant="danger" icon="trash" onClick={clear}>{t('Clear the log')}</Button></div>}
      </>}
  </AdminOnly>
}
