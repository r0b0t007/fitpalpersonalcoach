import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { passkeyAdd, webauthnOK } from '../lib/api.js'
import { inAppBrowser } from '../lib/inapp.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// S7: after a sign-in by email, link or code, the offer to make this device a passkey one. Not
// inside Instagram's browser or another app's: a passkey made there is lost or does not work. Once per device:
// "Not now" is remembered, and so is a passkey actually added; a sheet swiped away without either
// is offered again on the next link sign-in. On this device only (localStorage), since the point
// is this device's authenticator.
const KEY = 'gym_passkey_offer'

export function shouldOfferPasskey() {
  if (!webauthnOK() || inAppBrowser()) return false
  try { return !localStorage.getItem(KEY) } catch { return true }
}
/** After a sign-in by email, link or code: the offer, where it makes sense. */
export function offerPasskey() {
  if (shouldOfferPasskey()) useUI.getState().openSheet(close => <AddPasskeySheet close={close} />)
}
const remember = v => { try { localStorage.setItem(KEY, v) } catch { /* storage unavailable: offered again next time */ } }

export function AddPasskeySheet({ close }) {
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      await passkeyAdd()
      remember('added')
      close()
      useUI.getState().toast(t('Passkey added — next time, sign in with it.'))
    } catch (e) {
      setBusy(false)
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Could not add the passkey'))
    }
  }
  return <>
    <h3>{t('Add a passkey to this device?')}</h3>
    <div className="muted" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('You signed in by email. A passkey lets you sign in here with fingerprint, face or PIN next time — no email needed.')}
    </div>
    <Button variant="primary" icon="person" onClick={add} disabled={busy}>{busy ? t('Adding…') : t('Add passkey')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { remember('declined'); close() }}>{t('Not now')}</Button>
  </>
}
