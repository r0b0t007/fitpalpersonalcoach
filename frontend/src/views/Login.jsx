import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, webauthnOK, passkeyLogin, passkeyRegister, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { pendingInvite, clearInvite } from '../lib/invite.js'
import { useState, useRef, useEffect } from 'react'
import { BRAND } from '../lib/brand.js'
import Logo from '../components/Logo.jsx'
import InstallCard from '../components/InstallCard.jsx'
import { Button } from '../components/ui.jsx'

// No invite code yet? Leave a name and number; the request lands in the admin dashboard, and
// approval mints the code the gym then sends back by hand — the app never contacts anyone.
function RequestAccessSheet({ close }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    if (!name.trim()) { useUI.getState().toast(t('Enter a name')); return }
    if (!phone.trim()) { useUI.getState().toast(t('Enter a phone number')); return }
    try {
      await api('/api/access/request', { method: 'POST', body: JSON.stringify({ name: name.trim(), phone: phone.trim(), note: note.trim() }) })
      close()
      useUI.getState().toast(t('Request sent — the gym will send you your code.'))
    } catch (e) { useUI.getState().toast(e.message || t('Could not send the request')) }
  }
  return <>
    <h3>{t('Request access')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Leave your name and number — the gym reviews requests and sends you an invite code.')}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="tel" placeholder={t('Phone number')} maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" placeholder={t('Note (optional)')} maxLength={200} value={note} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Send request')}</Button>
  </>
}

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  // From the link when there is one; kept in the shared cache so dismissing this sheet and
  // reopening it does not lose the invite.
  const fromLink = pendingInvite()
  const [code, setCode] = useState(fromLink)
  const inviteOnly = !!config?.invite_only
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      clearInvite()   // redeemed: drop it from memory and from the address bar
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>
        {fromLink && code === fromLink
          ? t('Invite code filled in from your link.')
          : t('This app is invite-only — enter the code you were given.')}
      </div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
    {config?.request_access && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => { close(); useUI.getState().openSheet(c2 => <RequestAccessSheet close={c2} />) }}>
        {t('No code yet? Request access')}</Button>
    </>}
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  // Arriving from an invite link means the intent is already clear, so open the sheet rather than
  // leaving a prefilled field behind a button nobody was told to press. Waits for config, since
  // that decides whether the code field renders at all; DEMO has no backend to join.
  const opened = useRef(false)
  useEffect(() => {
    if (DEMO || opened.current || !config || !webauthnOK() || !pendingInvite()) return
    opened.current = true
    useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  }, [config])
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <h1 style={{ margin: '10px 0 6px' }}><Logo size={40} /></h1>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <InstallCard style={{ marginTop: 16 }} />
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {webauthnOK() ? <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>
        {canGuest && <div style={{ height: 10 }} />}
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>{canGuest
        ? t("This browser doesn't support passkeys — you can still use {0} locally on this device.", BRAND)
        // Without passkeys and without the guest entrance there is no way in from this browser,
        // so say that plainly instead of offering a local profile that cannot be created.
        : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      <InstallCard style={{ marginTop: 20 }} />
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', BIO)}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
