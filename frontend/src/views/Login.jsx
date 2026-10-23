import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, webauthnOK, passkeyLogin, passkeyRegister, bioLabel, requestLoginLink } from '../lib/api.js'
import { useLocation } from 'react-router-dom'
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
import Icon from '../components/Icon.jsx'

// The request-access form ("leave your name and number, the gym sends you a code") is gone: a
// coach's clients arrive by the coach's own link, and both APIs answer `request_access: false`.

/**
 * Who sent this link, according to the server, and whether they can take anyone on right now.
 *
 * `undefined` while asking, `null` for "nobody / not a live invite". The distinction matters: a
 * screen that renders "someone invited you" before the answer arrives, and then takes it back,
 * is worse than one that waits a beat. GET /api/invite deliberately 404s for a spent, revoked or
 * unknown code, so a stale link quietly falls back to the ordinary sign-up.
 *
 * `full` (R4, Laravel only) is the coach's plan having no seat left: registration would be refused
 * after the passkey prompt, so the screen says so first. The Node API never sends it.
 */
let inviterAsked = null
const INVITE_WAIT_MS = 2500
function useInvite() {
  const code = pendingInvite()
  const [answer, setAnswer] = useState(undefined)
  useEffect(() => {
    if (!code || DEMO) { setAnswer(null); return }
    let alive = true
    // Asked once per code, not once per component. The register sheet auto-opens OVER the rendered
    // Login and both want the answer, which was two identical unauthenticated requests on every
    // single arrival from a link — the one request shape anybody can make without an account.
    if (!inviterAsked) inviterAsked = api('/api/invite?code=' + encodeURIComponent(code))
      .then(d => (d.coachName ? { name: d.coachName, full: d.full === true } : null))
      // Offline, or the code is spent. Either way there is nobody to name, and registration is
      // still perfectly possible — the code rides along and the server decides.
      .catch(() => null)
    inviterAsked.then(a => { if (alive) setAnswer(a) })
    return () => { alive = false }
  }, [code])
  return answer
}
const useInviter = () => { const a = useInvite(); return a === undefined ? undefined : a?.name || null }

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  // From the link when there is one; kept in the shared cache so dismissing this sheet and
  // reopening it does not lose the invite.
  const fromLink = pendingInvite()
  const [code, setCode] = useState(fromLink)
  const inviteOnly = !!config?.invite_only
  const inviter = useInviter()
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
      const u = await passkeyRegister(n, (inviter ? fromLink : code).trim())
      clearInvite()   // redeemed: drop it from memory and from the address bar
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{inviter ? t('{0} invited you', inviter) : t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {inviter
        ? t('Pick a name and confirm with {0}. You will arrive on {1}’s client list — they can see your training and send you programs.', bioLabel(), inviter)
        : t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', bioLabel())}
    </div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {/* Read-only once the link has been checked and a coach named: there is nothing to decide,
        and an editable field invites someone to "fix" a code that is already right. It is still
        shown rather than hidden, so what is about to happen is visible. */}
    {(inviteOnly || inviter) && <>
      <div style={{ height: 10 }} />
      {/* `fromLink`, not `code`, whenever a coach was named: this sheet can open while GET
          /api/invite is still in flight (Login's INVITE_WAIT_MS, or a tap on "Create new
          profile"), so anything typed in that window
          would otherwise be frozen into a read-only field captioned "From your invite link" —
          registration then fails with "invite code is no longer valid" and nothing on the screen
          can put it right. What the link carries is what gets sent. */}
      <input className="input" placeholder={t('Invite code')} maxLength={40}
        value={inviter ? fromLink : code}
        readOnly={!!inviter} onChange={e => setCode(e.target.value.toUpperCase())}
        style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center', ...(inviter ? { opacity: .7 } : {}) }} />
      <div className="dim small" style={{ marginTop: 6 }}>
        {inviter
          ? t('From your invite link.')
          : fromLink && code === fromLink
            ? t('Invite code filled in from your link.')
            : t('This app is invite-only — enter the code you were given.')}
      </div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

/**
 * S5: a coach's way back in when the passkey is gone — a link by email (R4, Laravel only, where
 * /api/config says `login_email`). The passkey stays first; this is the fallback under it.
 *
 * "Check your inbox" is said the same whether or not the address belongs to anyone: the server
 * answers alike for both, deliberately, so the screen cannot be used to find out who is a coach.
 */
function EmailSignIn({ focus }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { if (focus && !sent) setTimeout(() => ref.current?.focus(), 50) }, [focus, sent])
  const go = async () => {
    const e = email.trim()
    if (!/^[^s@]+@[^s@]+.[^s@]+$/.test(e)) { useUI.getState().toast(t('Enter your email address')); return }
    setBusy(true)
    try { await requestLoginLink(e); setSent(true) }
    catch (err) { useUI.getState().toast(err.message || t('Could not send the link')) }
    finally { setBusy(false) }
  }
  if (sent) return <div className="card" role="status" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <Icon name="link" size={28} style={{ color: 'var(--acc)' }} />
    <div style={{ fontWeight: 600, marginTop: 4 }}>{t('Check your inbox')}</div>
    <div className="small muted" style={{ lineHeight: 1.38 }}>{t('If that address belongs to a coach, a sign-in link is on its way. It works once, for 15 minutes.')}</div>
    <Button style={{ marginTop: 6 }} onClick={() => { setSent(false); setEmail('') }}>{t('Use another address')}</Button>
  </div>
  return <div className="card" style={{ textAlign: 'left' }}>
    <input ref={ref} className="input" type="email" placeholder={t('Your email')} maxLength={254} autoComplete="email"
      value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Sending…') : t('Send me a link')}</Button>
  </div>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  // The email path (S5): only where the server has it. Opened straight away when the link page
  // sent the coach here for a new link (/link → "Get a new link", ?email=1).
  const loc = useLocation()
  const emailPath = !!config?.login_email
  const [emailOpen, setEmailOpen] = useState(() => new URLSearchParams(loc.search).has('email'))
  const invite = useInvite()
  const inviter = invite === undefined ? undefined : invite?.name || null
  const full = !!invite?.full
  // Arriving from an invite link means the intent is already clear, so open the sheet rather than
  // leaving a prefilled field behind a button nobody was told to press. Waits for config, since
  // that decides whether the code field renders at all; DEMO has no backend to join. And for the
  // link's answer: when the coach takes nobody on right now the sign-up would be refused after the
  // passkey prompt, so the screen says that instead of opening a sheet that cannot succeed — but
  // only for so long: a request that hangs must not leave someone who came to sign up with no
  // sheet at all, so after INVITE_WAIT_MS it opens anyway and the server decides, as it did before.
  const opened = useRef(false)
  const [waited, setWaited] = useState(false)
  useEffect(() => { const tm = setTimeout(() => setWaited(true), INVITE_WAIT_MS); return () => clearTimeout(tm) }, [])
  useEffect(() => {
    if (DEMO || opened.current || !config || !webauthnOK() || !pendingInvite() || (invite === undefined && !waited) || full) return
    opened.current = true
    useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  }, [config, invite, waited])
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
      <div className="muted" style={{ marginBottom: full ? 14 : 34 }}>
        {inviter ? t('{0} invited you to train with them.', inviter) : t('Your coach. Your plan. Your progress.')}
      </div>
      {/* `full` is either reason the coach takes nobody on — every seat taken, or a plan that is
          paused — so the copy names neither, as the server's own refusal does. */}
      {full && <div className="card small" role="status" style={{ textAlign: 'left', marginBottom: 20, lineHeight: 1.4 }}>
        {t('{0} cannot take on new clients right now. Ask them about it — this link will work once they can.', inviter)}
      </div>}
      {webauthnOK() ? <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        {emailPath && <>
          <Button variant="ghost" icon="link" style={{ color: 'var(--label-2)' }} onClick={() => setEmailOpen(o => !o)}
            aria-expanded={emailOpen}>{t('Sign in with email')}</Button>
          {emailOpen && <EmailSignIn focus />}
          <div style={{ height: 10 }} />
        </>}
        {/* Not while the inviting coach takes nobody on: the sheet would carry their code into a
            refusal that only comes after the passkey prompt. Signing in stays open. */}
        {!full && <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>}
        {canGuest && <div style={{ height: 10 }} />}
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>{canGuest
        ? t("This browser doesn't support passkeys — you can still use {0} locally on this device.", BRAND)
        // Without passkeys and without the guest entrance there is no way in from this browser,
        // so say that plainly instead of offering a local profile that cannot be created.
        : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      <InstallCard style={{ marginTop: 20 }} />
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', bioLabel())}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
