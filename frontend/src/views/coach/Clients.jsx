import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate, todayISO } from '../../lib/format.js'
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

  const load = () => api('/api/coach/members').then(d => setMembers(d.members)).catch(e => toast(e.message || 'Failed to load'))
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
      <div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>Clients</h1>
        <div className="sub">{members ? active.length + (active.length === 1 ? ' client' : ' clients') : 'Loading…'}</div></div>
      <Button variant="tinted" size="sm" icon="plus" onClick={() => openSheet(() => <InviteSheet />)}>Invite</Button>
    </div>

    {active.length > 6 && <div style={{ marginBottom: 12 }}>
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Search clients" />
    </div>}

    <div className="list">
      {rows.map(({ m, reason }) => <button key={m.id} className="item" onClick={() => nav('/clients/' + encodeURIComponent(m.id))}>
        <div className="grow">
          <div className="tt">
            {m.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{m.name}
            {m.pending?.length > 0 && <span className="tag" style={{ marginLeft: 6 }}>program waiting</span>}
            {!m.pending?.length && m.lastDecision?.status === 'declined' && <span className="tag" style={{ marginLeft: 6, color: 'var(--yellow)' }}>declined</span>}
            {!m.pending?.length && m.lastDecision?.status === 'accepted' && <span className="tag acc" style={{ marginLeft: 6 }}>accepted</span>}
          </div>
          <div className="ss">
            {m.live ? 'training now · ' + m.live.name
              : reason ? reason.title + ' · ' + reason.detail
                : m.workouts + ' workouts' + (m.lastWorkout ? ' · last ' + fmtDate(m.lastWorkout) : '') + ' · synced ' + rel(m.lastSync)}
          </div>
        </div>
        <RosterAdherence parts={m.adherence} />
        <Icon name="chevronRight" className="chev" />
      </button>)}
      {members && !active.length && <div className="empty">
        No clients yet. Make an invite code and give it to whoever is joining — they arrive on your roster the moment they sign up.
      </div>}
      {members && active.length > 0 && !rows.length && <div className="empty">Nobody matches “{q}”.</div>}
    </div>
  </div>
}
