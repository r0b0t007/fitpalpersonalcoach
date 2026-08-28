import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO, MONTHS_LONG } from '../lib/format.js'
import Icon from '../components/Icon.jsx'

// Group sessions (coached classes) — view-only for everyone, guests included: the endpoint
// is public and nothing here writes. Admins manage the timetable from the admin dashboard.
// Booking is out of scope, so capacity reads as information ("ask at the desk"), not a button.

const endOf = (time, min) => {
  const [h, m] = time.split(':').map(Number)
  const tot = h * 60 + m + (min || 0)
  return String(Math.floor(tot / 60) % 24).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0')
}

function SessionRow({ s, onClick }) {
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19, background: 'var(--acc-soft)', color: 'var(--acc)' }}><Icon name="people" /></span>
    <div className="grow"><div className="tt">{s.title}</div>
      <div className="ss">{[s.time + '–' + endOf(s.time, s.minutes), s.coach, s.minutes + ' min'].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}

function SessionDetail({ s }) {
  return <>
    <h3>{s.title}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {[fmtDate(s.date, true), s.time + '–' + endOf(s.time, s.minutes), s.minutes + ' min'].join(' · ')}
    </div>
    {s.coach && <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <Icon name="person" style={{ color: 'var(--label-2)' }} /><span>{t('Coach: {0}', s.coach)}</span>
    </div>}
    {s.capacity > 0 && <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <Icon name="people" style={{ color: 'var(--label-2)' }} /><span>{t('{0} spots — ask at the desk to join', s.capacity)}</span>
    </div>}
    {s.note && <div className="muted small" style={{ lineHeight: 1.5 }}>{s.note}</div>}
    <div style={{ height: 6 }} />
  </>
}

export default function Sessions() {
  const [sessions, setSessions] = useState(null)
  const [cur, setCur] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const openSheet = useUI(s => s.openSheet)
  useEffect(() => { api('/api/sessions').then(d => setSessions(d.sessions)).catch(() => setSessions([])) }, [])

  const byDay = {}
  for (const s of sessions || []) (byDay[s.date] = byDay[s.date] || []).push(s)

  const detail = s => openSheet(() => <SessionDetail s={s} />)
  const openDay = iso => {
    const list = byDay[iso]
    if (!list) return
    if (list.length === 1) return detail(list[0])
    openSheet(close => <><h3>{fmtDate(iso, true)}</h3><div className="list">
      {list.map(s => <SessionRow key={s.id} s={s} onClick={() => { close(); detail(s) }} />)}</div></>)
  }

  // month grid — same .cal-* system as the workout calendar, dots in the accent (brand gold)
  const y = cur.getFullYear(), mo = cur.getMonth()
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthCount = Object.keys(byDay).filter(d => d.startsWith(y + '-' + String(mo + 1).padStart(2, '0'))).reduce((a, d) => a + byDay[d].length, 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const has = !!byDay[iso]
    cells.push(<button key={d} className={'cal-d' + (has ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => openDay(iso)}>
      <span>{d}</span><i className={has ? 'done' : ''} /></button>)
  }

  const upcomingDays = Object.keys(byDay).filter(d => d >= todayISO()).sort()

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Sessions')}</h1><div className="sub">{t('Group classes at the gym')}</div></div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 2 }}>
        <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
        <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
        <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
      </div>
      <div className="small muted" style={{ textAlign: 'center' }}>
        {monthCount ? t(monthCount === 1 ? '{0} session' : '{0} sessions', monthCount) : t('No sessions this month')}
      </div>
      <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    </div>

    <h4 className="sec">{t('Upcoming')}</h4>
    {sessions == null ? <div className="muted small">{t('Loading…')}</div>
      : upcomingDays.length ? upcomingDays.map(d => <div key={d} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{d === todayISO() ? t('Today') : fmtDate(d, true)}</div>
        <div className="list">{byDay[d].map(s => <SessionRow key={s.id} s={s} onClick={() => detail(s)} />)}</div>
      </div>)
      : <div className="empty">{t('No sessions scheduled yet.')}</div>}
  </div>
}
