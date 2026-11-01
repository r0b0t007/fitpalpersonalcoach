import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { t, tp } from '../../lib/i18n.js'
import { equipmentLabel, goalLabel, levelLabel } from '../../lib/join.js'
import { useUI } from '../../store/useUI.js'
import { Button, Notice } from '../../components/ui.jsx'
import { rel } from './parts.jsx'

/** How many requests wait on this coach, for Today's card — a count, no intakes; null until known (and on a failed read). */
export function usePendingRequests() {
  const [n, setN] = useState(null)
  useEffect(() => {
    let live = true
    api('/api/coach/requests/count').then(r => { if (live) setN(r.pending) }).catch(() => {})
    return () => { live = false }
  }, [])
  return n
}

const STATUS_LABEL = { accepted: () => t('Accepted'), declined: () => t('Declined'), expired: () => t('Lapsed') }

/**
 * The coach's requests inbox (CHW-337): the followers who asked to train with them from their page,
 * what they answered, and Accept or Decline. Accept puts them on the roster — the server decides
 * the seat, and says so when the plan is full; the request then stays here, waiting. Tapping a
 * request opens it in place: one hand, one screen.
 */
export default function Requests() {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = msg => useUI.getState().toast(msg)

  const load = () => api('/api/coach/requests').then(r => setList(r.requests))
  useEffect(() => { load().catch(e => setError(e.message)) }, [])

  const decide = async (r, accept) => {
    setBusy(true); setError(null)
    try {
      const res = await api('/api/coach/requests/decide', { method: 'POST', body: JSON.stringify({ id: r.id, accept }) })
      setList(res.requests); setOpen(null)
      if (res.member) toast(t('{0} is on your roster', res.member.name))
    } catch (e) {
      // Refused, but not always unchanged: a follower who found another coach meanwhile has lapsed,
      // a request answered elsewhere is gone. The list is read again so it shows what is true now.
      setError(e.message); setOpen(null)
      await load().catch(() => {})
    }
    setBusy(false)
  }

  const waiting = (list || []).filter(r => r.status === 'pending')
  const decided = (list || []).filter(r => r.status !== 'pending')
  const summary = i => [goalLabel(i.goal), levelLabel(i.level), tp(i.days, '{0} day a week', '{0} days a week')].filter(Boolean).join(' · ')

  return <div className="narrow">
    <div className="hdr"><div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('Requests')}</h1>
      <div className="sub">{t('People who asked to train with you from your page.')}</div></div></div>

    {error && <Notice icon="warning" tone="warn" title={error} />}
    {list && !list.length && <Notice icon="people" title={t('No requests yet')} body={t('Share your page link in your Instagram bio: requests land here.')} />}

    {waiting.length > 0 && <div className="list">{waiting.map(r => <div key={r.id} className="card" style={{ padding: 0 }}>
      <button className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{summary(r.intake)}</div></div>
        <span className="dim small">{rel(r.created)}</span>
      </button>
      {open === r.id && <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="small muted">{r.email}</div>
        {r.intake.injuries && <div><div className="dim small">{t('Injuries or pain to know about')}</div><div>{r.intake.injuries}</div></div>}
        {r.intake.equipment?.length > 0 && <div><div className="dim small">{t('What you can train with')}</div>
          <div>{r.intake.equipment.map(equipmentLabel).join(', ')}</div></div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => decide(r, true)} disabled={busy}>{t('Accept')}</Button>
          <Button onClick={() => decide(r, false)} disabled={busy}>{t('Decline')}</Button>
          {r.intake.phone && <a className="btn plain" href={'https://wa.me/' + r.intake.phone} target="_blank" rel="noopener noreferrer"><span>WhatsApp</span></a>}
        </div>
      </div>}
    </div>)}</div>}

    {decided.length > 0 && <>
      <h4 className="sec">{t('Answered')}</h4>
      <div className="list">{decided.map(r => <div key={r.id} className="item">
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{rel(r.decided || r.created)}</div></div>
        <span className={'tag' + (r.status === 'accepted' ? ' acc' : '')}>{STATUS_LABEL[r.status]?.() ?? r.status}</span>
      </div>)}</div>
    </>}
  </div>
}
