import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate, todayISO } from '../../lib/format.js'
import { t, tp } from '../../lib/i18n.js'
import { reasonFor } from '../../lib/roster-attention.js'
import Icon from '../../components/Icon.jsx'
import { Button, SearchField } from '../../components/ui.jsx'
import { RosterAdherence, rel } from './parts.jsx'
import { InviteSheet } from './sheets.jsx'

// The roster. Clients who need something float to the top (same scoring as Today's list), the
// rest sort by name; the search is for the day the list stops fitting on one screen.
export default function Clients() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [members, setMembers] = useState(null)
  const [q, setQ] = useState('')

  const load = () => api('/api/coach/members').then(d => setMembers(d.members)).catch(e => toast(e.message || t('Failed to load')))
  useEffect(() => {
    load()
    const iv = setInterval(load, 15000)
    return () => clearInterval(iv)
  }, [])

  const today = todayISO()
  const needle = q.trim().toLowerCase()
  // One population for the count, the threshold and the list: with disabled accounts in the mix
  // a roster of five active clients grew a search field, and a subtitle taken from the filtered
  // rows counted down while the coach typed.
  const active = (members || []).filter(m => !m.disabled)
  const rows = active
    .filter(m => !needle || m.name.toLowerCase().includes(needle))
    .map(m => ({ m, reason: reasonFor(m, today) }))
    .sort((a, b) => (a.reason ? a.reason.rank : 99) - (b.reason ? b.reason.rank : 99) || a.m.name.localeCompare(b.m.name))

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('Clients')}</h1>
        <div className="sub">{members ? tp(active.length, '{0} client', '{0} clients') : t('Loading…')}</div></div>
      <Button variant="tinted" size="sm" icon="link" onClick={() => openSheet(() => <InviteSheet />)}>{t('Invite')}</Button>
    </div>

    {active.length > 6 && <div style={{ marginBottom: 12 }}>
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search clients')} />
    </div>}

    <div className="list">
      {rows.map(({ m, reason }) => <button key={m.id} className="item" onClick={() => nav('/clients/' + encodeURIComponent(m.id))}>
        <div className="grow">
          <div className="tt">
            {m.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{m.name}
            {m.pending?.length > 0 && <span className="tag" style={{ marginLeft: 6 }}>{t('program waiting')}</span>}
            {!m.pending?.length && m.lastDecision?.status === 'declined' && <span className="tag" style={{ marginLeft: 6, color: 'var(--yellow)' }}>{t('declined')}</span>}
            {!m.pending?.length && m.lastDecision?.status === 'accepted' && <span className="tag acc" style={{ marginLeft: 6 }}>{t('accepted')}</span>}
          </div>
          <div className="ss">
            {m.live ? t('training now · {0}', m.live.name)
              : reason ? reason.title + ' · ' + reason.detail
                : tp(m.workouts, '{0} workout', '{0} workouts') + (m.lastWorkout ? ' · ' + t('last {0}', fmtDate(m.lastWorkout)) : '') + ' · ' + t('synced {0}', rel(m.lastSync))}
          </div>
        </div>
        <RosterAdherence parts={m.adherence} />
        <Icon name="chevronRight" className="chev" />
      </button>)}
      {members && !active.length && <div className="empty">
        {t('No clients yet. Send someone an invite link — they open it, make their profile, and arrive on your roster.')}
      </div>}
      {members && active.length > 0 && !rows.length && <div className="empty">{t('Nobody matches “{0}”.', q)}</div>}
    </div>
  </div>
}
