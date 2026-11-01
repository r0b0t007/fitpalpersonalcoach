import { useState } from 'react'
import { api } from '../../lib/api.js'
import { notesOn } from '../../lib/notes.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextArea } from '../../components/ui.jsx'

// The coach's replies under one check-in or workout on a client's page (CHW-340), and the box to
// add one. The client hears of it by a push, or by an email at most once a day (the server's).
// `onNotes` takes the client's whole list back from the server, so every thread on the page
// redraws from one answer.
const BODY_MAX = 1000   // backend CoachNote::BODY_MAX

export default function NoteThread({ notes, refType, refKey, memberId, onNotes }) {
  const thread = notesOn(notes, refType, refKey)
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const send = async () => {
    setBusy(true); setError(null)
    try {
      const r = await api('/api/coach/notes', { method: 'POST', body: JSON.stringify({ memberId, refType, refKey, body }) })
      onNotes(r.notes || [])
      setBody(''); setOpen(false)
    } catch (e) { setError(e.message) }
    setBusy(false)
  }
  return <div style={{ marginTop: 6 }}>
    {thread.map(n => <div key={n.id} className="small" style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '6px 9px', marginTop: 4, whiteSpace: 'pre-wrap' }}>
      {n.body}
      {!n.readAt && <span className="dim" style={{ fontSize: '.7rem', marginLeft: 6 }}>· {t('not read yet')}</span>}
    </div>)}
    {open ? <div style={{ marginTop: 6 }}>
      <TextArea name="note" rows={2} maxLength={BODY_MAX} value={body} onChange={e => { setBody(e.target.value); setError(null) }}
        placeholder={t('Write to them…')} autoFocus />
      {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 4 }}>{error}</div>}
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <Button size="sm" variant="primary" onClick={send} disabled={busy || !body.trim()}>{t('Send reply')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null) }}>{t('Cancel')}</Button>
      </div>
    </div>
      : <button className="btn ghost sm" style={{ marginTop: 4, width: 'auto' }} onClick={() => setOpen(true)}>
        <Icon name="pencil" /> {thread.length ? t('Reply again') : t('Reply')}
      </button>}
  </div>
}
