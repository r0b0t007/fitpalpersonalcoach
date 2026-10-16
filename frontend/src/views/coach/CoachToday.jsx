import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate, todayISO } from '../../lib/format.js'
import { t, tp } from '../../lib/i18n.js'
import { setShellPref, homeFor } from '../../lib/role.js'
import { attentionItems } from '../../lib/roster-attention.js'
import { activityFeed } from '../../lib/roster-activity.js'
import { fetchPrograms } from '../../lib/programs.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { dur, rel } from './parts.jsx'
import { InviteSheet, MediaSheet } from './sheets.jsx'

// The coach's landing screen: what needs me, who is training, what happened. A coach opens the
// app several times a day to triage, so the list of clients who need something comes first and
// the roster itself lives on its own tab.
//
// Roster and activity are derived client-side from GET /api/coach/members (lib/roster-attention,
// lib/roster-activity) — the server ships dates and counts, this screen decides what they mean.
export default function CoachToday() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const [programs, setPrograms] = useState([])
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [members, setMembers] = useState(null)

  const load = () => api('/api/coach/members').then(d => setMembers(d.members)).catch(e => toast(e.message || t('Failed to load')))
  useEffect(() => {
    load()
    const iv = setInterval(load, 15000)   // keeps "training now" live
    return () => clearInterval(iv)
  }, [])
  // The library lives on the server (lib/programs.js). Today only reads it — the Programs tab
  // owns saving, deleting and the migration of a pre-server library.
  useEffect(() => { fetchPrograms().then(d => setPrograms(d.programs)).catch(() => {}) }, [])

  const today = todayISO()
  const roster = (members || []).filter(m => !m.disabled)
  const live = roster.filter(m => m.live)
  const active = roster.filter(m => m.lastSync && Date.now() - m.lastSync < 7 * 86400000).length
  const attention = attentionItems(roster, today)
  const activity = activityFeed(roster)
  const open = id => nav('/clients/' + encodeURIComponent(id))

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('Today')}</h1>
        <div className="sub">{fmtDate(today, true)}{user?.name ? ' · ' + user.name : ''}</div></div>
      {/* The coach's own training lives in the other shell (lib/role.js); this is the door. */}
      <button className="btn sm tinted" onClick={() => { setShellPref('client'); nav(homeFor(user, 'client')) }}>{t('Train myself')}</button>
      <button className="iconbtn" onClick={load} aria-label={t('Refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile tappable" onClick={() => nav('/clients')}><div className="l">{t('Clients')}</div><div className="v">{members ? roster.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: live.length ? 'var(--acc)' : undefined }}>{members ? live.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{members ? active : '—'}</div></div>
    </div>

    {members && !roster.length && <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>{t('Invite your first client')}</h2>
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.4 }}>
        {t('Send them a link. They open it, make their profile, and arrive on your roster — nobody has to assign them afterwards.')}
      </div>
      <Button variant="primary" icon="link" onClick={() => openSheet(() => <InviteSheet />)}>{t('Invite a client')}</Button>
    </div>}

    {roster.length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>{t('Needs attention')}</h2>
      {attention.length ? attention.map(a => (
        <button key={a.id} className="row between" style={{ width: '100%', textAlign: 'left', padding: '9px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => open(a.id)}>
          <div><div className="small" style={{ fontWeight: 600 }}>{a.name}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{a.title} · {a.detail}</div></div>
          <Icon name="chevronRight" className="chev" />
        </button>
      )) : <div className="dim small">{t('Everyone is on track.')}</div>}
    </div>}

    {live.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {live.map(m => <button key={m.id} className="row between" style={{ width: '100%', textAlign: 'left', padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => open(m.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{m.live.name} · {t('ex {0}/{1}', m.live.exIdx, m.live.exTotal)} · {t('{0}/{1} sets', m.live.setsDone, m.live.setsTotal)}</div></div>
        <span className="tag acc">{dur(Date.now() - m.live.startedAt)}</span>
      </button>)}
    </div>}

    {activity.length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>{t('Recent activity')}</h2>
      {activity.map((e, i) => <button key={e.id + e.kind + i} className="row between" style={{ width: '100%', textAlign: 'left', padding: '7px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => open(e.id)}>
        <div className="small"><b>{e.name}</b> <span className="muted">{e.text}</span></div>
        <span className="dim" style={{ fontSize: '.72rem', flex: 'none' }}>{rel(e.t)}</span>
      </button>)}
    </div>}

    {/* Invites and demos stay here until Account lands; Programs has its own tab now, so Today
        keeps only a way in rather than a second copy of the library. */}
    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/programs')}>
      <div className="row between">
        <div>
          <div className="lbl2">{t('Programs')}</div>
          <div className="ttl">{programs.length ? t('{0} in your library', programs.length) : t('Nothing saved yet')}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>

    {roster.length > 0 && <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite a client')}</h2>
        <Button variant="primary" size="sm" icon="link" onClick={() => openSheet(() => <InviteSheet />)}>{t('Invite')}</Button></div>
      <div className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.4 }}>
        {t('Send them a link. They open it, make their profile, and arrive on your roster. Each link works once.')}
      </div>
    </div>}

    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{t('Exercise demos')}</h2>
        <Button variant="primary" size="sm" icon="camera" onClick={() => openSheet(() => <MediaSheet />)}>{t('Upload a video')}</Button></div>
      <div className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.4 }}>
        {t('Your own footage of a lift, shown to clients in place of the stock animation — including on the exercises you invented, which have never had one.')}
      </div>
    </div>
  </div>
}
