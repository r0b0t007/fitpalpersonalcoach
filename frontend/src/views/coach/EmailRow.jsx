import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { fetchAccount, changeEmail } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { Button, Row } from '../../components/ui.jsx'

/**
 * C23: the coach's sign-in address on Account (R4, Laravel only — `login_email` in /api/config).
 * Four states, from GET /api/account {email, pendingEmail, verified}:
 *
 *   confirmed — the address sign-in links go to
 *   unconfirmed — a new sign-up: only the pending address, until its first link is opened
 *   changing — the old address still in force, the new one waiting for its link
 *   none — an account from before R4, with nowhere to send a link
 *
 * The address never changes until the link to the new one is opened (Link.jsx then says so), and
 * the old one is told. Clients have no row: only coaches sign in by link.
 */
export function EmailRow() {
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const [account, setAccount] = useState(null)
  const on = !!config?.login_email && !!user?.coach
  const load = () => fetchAccount().then(setAccount).catch(() => {})
  useEffect(() => { if (on) load() }, [on, user?.id])
  if (!on || !account) return null

  const { email, pendingEmail, verified } = account
  const change = () => openSheet(close => <ChangeEmailSheet close={close} current={email} onSent={load} />)

  if (!email && pendingEmail) return <Row icon="key" iconTint="var(--grey)" title={pendingEmail}
    subtitle={t('Not confirmed yet — open the link we sent')}>
    <ResendButton email={pendingEmail} />
  </Row>
  if (!email) return <Row icon="key" iconTint="var(--acc)" title={t('Add an email')}
    subtitle={t('Lets you sign in by link if you lose your passkey')} accessory="chevron" onClick={change} />
  if (pendingEmail) return <Row icon="key" iconTint="var(--grey)" title={email}
    subtitle={t('Waiting for confirmation of {0}', pendingEmail)} accessory="chevron" onClick={change}>
    <span className="tag" style={{ flex: 'none' }}>{t('pending')}</span>
  </Row>
  return <Row icon="key" iconTint="var(--grey)" title={email}
    subtitle={verified ? t('Verified · for sign-in links and receipts') : t('For sign-in links and receipts')}
    accessory="chevron" onClick={change} />
}

/** Sends the confirmation link again — the same request as a change, to the address already pending. */
function ResendButton({ email }) {
  const [busy, setBusy] = useState(false)
  const go = async ev => {
    ev.stopPropagation()
    setBusy(true)
    try { await changeEmail(email); useUI.getState().toast(t('Link sent to {0}', email)) }
    catch (e) { useUI.getState().toast(e.message || t('Could not send the link')) }
    finally { setBusy(false) }
  }
  return <Button variant="tinted" size="xs" style={{ flex: 'none' }} onClick={go} disabled={busy}>{t('Resend')}</Button>
}

function ChangeEmailSheet({ close, current, onSent }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    const e = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { useUI.getState().toast(t('Enter your email address')); return }
    setBusy(true)
    try {
      await changeEmail(e)
      close()
      useUI.getState().toast(t('Link sent to {0}', e))
      onSent()
    // A session that signed in a while ago is refused (the server wants a recent sign-in for a
    // write that outlives it) — its own sentence says what to do.
    } catch (err) { setBusy(false); useUI.getState().toast(err.message || t('Could not send the link')) }
  }
  return <>
    <h3>{current ? t('Change email') : t('Add an email')}</h3>
    <input ref={ref} className="input" type="email" placeholder={current ? t('New email') : t('Your email')} maxLength={254}
      autoComplete="email" value={email} onChange={ev => setEmail(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') go() }} />
    <div className="dim small" style={{ margin: '6px 4px 12px', lineHeight: 1.4 }}>
      {current
        ? t('We’ll send a link to the new address. Your sign-in email changes when you open it.')
        : t('We’ll send a link to it. It becomes your sign-in email when you open it.')}
    </div>
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Sending…') : t('Send link')}</Button>
  </>
}
