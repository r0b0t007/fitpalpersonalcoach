import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { deleteAccount, fetchAccount, requestLoginLink, signInWithCode } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button, CodeField } from '../components/ui.jsx'

// The server's refusal of a session that did not sign in just now (RequireFreshAuth). Pest
// (AccountDeleteTest) holds this copy to the middleware's own sentence.
export const NOT_FRESH = 'sign in again to do this — it needs a recent sign-in'

/**
 * A client deleting their own account (CHW-363): one warning that names what goes and points at
 * the export, then the delete. The server wants proof of the account from just now, so a session
 * that signed in a while ago is sent a code to its own address, and typing it signs this browser
 * in afresh — the sign-in clients already use (CHW-331), and the address the code goes to is the
 * account's own, so it cannot become someone else's. An account with no confirmed address (no code
 * is mailed to one) says to sign in again with its passkey, the server's own sentence. The mail can
 * be throttled without a word (the server answers the same either way), so the code step can send
 * it again, or be left.
 */
export function DeleteAccountSheet({ close, onDeleted }) {
  const [step, setStep] = useState('warn')   // warn → code (when the session is not fresh)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // A second tap or Enter before the first settles would spend the code twice: the state lags a render.
  const going = useRef(false)
  const once = fn => async () => {
    if (going.current) return
    going.current = true; setBusy(true)
    try { await fn() } finally { going.current = false; setBusy(false) }
  }
  const toast = useUI.getState().toast

  const finish = async () => {
    await deleteAccount()
    close()
    useStore.getState().forgetLocalSession()
    onDeleted()
    toast(t('Your account is deleted'))
  }

  const start = once(async () => {
    try { await finish() } catch (e) {
      if (e.error !== NOT_FRESH) { toast(e.message); return }
      try {
        const account = await fetchAccount()
        if (!account.email || !account.verified) { toast(e.message); return }
        await requestLoginLink(account.email)
        setEmail(account.email); setStep('code')
      } catch (err) { toast(err.message) }
    }
  })

  const confirm = once(async () => {
    if (code.length !== 6) { toast(t('Enter the 6-digit code we sent to {0}.', email)); return }
    try { await signInWithCode(email, code); await finish() } catch (e) { toast(e.message) }
  })

  const resend = once(async () => {
    try { await requestLoginLink(email); toast(t('Enter the 6-digit code we sent to {0}.', email)) } catch (e) { toast(e.message) }
  })

  if (step === 'code') return <>
    <h3>{t('Confirm it’s you')}</h3>
    <div className="dim small" style={{ margin: '0 4px 12px', lineHeight: 1.4 }}>{t('Enter the 6-digit code we sent to {0}.', email)}</div>
    <CodeField value={code} onChange={setCode} autoFocus onKeyDown={ev => { if (ev.key === 'Enter') confirm() }} />
    <Button variant="danger" onClick={confirm} disabled={busy} style={{ marginTop: 12 }}>{busy ? t('Deleting…') : t('Delete my account')}</Button>
    <Button variant="ghost" onClick={resend} disabled={busy} style={{ marginTop: 4 }}>{t('Send the code again')}</Button>
    <Button variant="ghost" className="dim" onClick={close} disabled={busy}>{t('Cancel')}</Button>
  </>

  return <>
    <h3>{t('Delete your account?')}</h3>
    <div className="dim small" style={{ margin: '0 4px 12px', lineHeight: 1.4 }}>
      {t('Everything goes: your workouts, check-ins, weight, measurements, meals and photos, and what you told your coach when you asked to join. Your coach stops seeing you. This cannot be undone — export a backup first if you want a copy.')}
    </div>
    <Button variant="danger" onClick={start} disabled={busy}>{busy ? t('Deleting…') : t('Delete my account')}</Button>
    <Button variant="ghost" className="dim" onClick={close} disabled={busy} style={{ marginTop: 4 }}>{t('Cancel')}</Button>
  </>
}
