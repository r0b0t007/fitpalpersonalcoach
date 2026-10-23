import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { redeemLoginLink, passkeyLogin, webauthnOK } from '../lib/api.js'
import { homeFor, getShellPref } from '../lib/role.js'
import { t } from '../lib/i18n.js'
import Logo from '../components/Logo.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { AddPasskeySheet, shouldOfferPasskey } from '../components/AddPasskeySheet.jsx'

/** Whether /#/link is the email-link landing here: only on a server with sign-in by link. */
export const linkOpen = config => !!config?.login_email

// One redemption per token per page load. A link is single-use on the server, so a second POST —
// a remount, a re-render racing the first — would turn a good sign-in into "already used".
const redeemed = new Map()
const redeemOnce = token => {
  if (!redeemed.has(token)) redeemed.set(token, redeemLoginLink(token))
  return redeemed.get(token)
}

/** How long "You are signed in" shows before the app moves on — long enough to read, no longer. */
export const SIGNED_IN_MS = 900

/**
 * S6: where an emailed link lands (/#/link?t=…), signed in or not. Three outcomes from one POST:
 * a sign-in (the server sets the session; on to Today, and the passkey offer), a confirmed address
 * change (S6d), or a link that is spent or expired (S6c) — ordinary, not an error, so no red.
 */
export default function Link() {
  const loc = useLocation()
  const nav = useNavigate()
  const { setUser, pullState } = useStore()
  const signedIn = useStore(s => !!s.user)
  const [token] = useState(() => new URLSearchParams(loc.search).get('t') || '')
  const [state, setState] = useState(token ? { kind: 'loading' } : { kind: 'expired', message: '' })

  useEffect(() => {
    if (!token) return
    let live = true
    redeemOnce(token).then(async res => {
      if (!live) return
      // The token is spent: take it out of the address bar and the history entry.
      nav('/link', { replace: true })
      if (res.user) {
        setState({ kind: 'signedIn' })
        setUser(res.user)
        await pullState()
        setTimeout(() => {
          nav(homeFor(res.user, getShellPref()), { replace: true })
          if (shouldOfferPasskey()) useUI.getState().openSheet(close => <AddPasskeySheet close={close} />)
        }, SIGNED_IN_MS)
      } else setState({ kind: 'emailChanged', email: res.email })
    }).catch(e => { if (live) setState({ kind: 'expired', message: e.status ? e.message : t('Could not reach the server — try the link again.') }) })
    return () => { live = false }
  }, [token])

  const signInWithPasskey = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); nav(homeFor(u, getShellPref()), { replace: true }) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }

  const wrap = { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: '26vh', minHeight: '78vh' }
  const state1 = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%', marginTop: 40 }
  return <div className="narrow" style={wrap}>
    <h1 style={{ margin: '10px 0 6px' }}><Logo size={40} /></h1>
    {state.kind === 'loading' && <div style={{ ...state1, gap: 12 }} role="status">
      <span className="spin" aria-hidden="true" style={{ width: 28, height: 28 }} />
      <div className="muted">{t('Signing you in…')}</div>
    </div>}
    {state.kind === 'signedIn' && <div style={state1} role="status">
      <Icon name="checkCircle" size={32} style={{ color: 'var(--green)' }} />
      <div style={{ fontWeight: 600, marginTop: 6 }}>{t('You are signed in')}</div>
      <div className="small muted">{t('Taking you to Today…')}</div>
    </div>}
    {state.kind === 'emailChanged' && <div style={state1} role="status">
      <Icon name="checkCircle" size={32} style={{ color: 'var(--green)' }} />
      <div style={{ fontWeight: 600, marginTop: 6 }}>{t('Email changed')}</div>
      <div className="small muted">{t('Sign-in links now go to {0}.', state.email)}</div>
      <div style={{ width: '100%', marginTop: 18 }}>
        <Button variant="primary" onClick={() => nav(signedIn ? '/account' : '/home', { replace: true })}>
          {signedIn ? t('Back to Account') : t('Sign in')}</Button>
      </div>
    </div>}
    {state.kind === 'expired' && <div style={state1} role="status">
      <Icon name="clock" size={32} style={{ color: 'var(--label-3)' }} />
      <div style={{ fontWeight: 600, marginTop: 6 }}>{t('This link no longer works')}</div>
      {/* The server's own sentence when it gave one ("…has expired", "…was already used"); room for two lines. */}
      <div className="small muted" style={{ minHeight: 36, lineHeight: 1.38 }}>{state.message || t('Sign-in links work once, for 15 minutes.')}</div>
      <div style={{ width: '100%', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* The link carries no address, so the coach types it again, with the field ready. Signed
            in, it was an address change: a new one is asked for on Account. */}
        <Button variant="primary" onClick={() => nav(signedIn ? '/account' : '/home?email=1', { replace: true })}>{t('Get a new link')}</Button>
        {webauthnOK() && !signedIn && <Button onClick={signInWithPasskey}>{t('Sign in with passkey')}</Button>}
      </div>
    </div>}
  </div>
}
