import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coachSignupStart, coachSignupVerify } from '../lib/api.js'
import { paidPlans, pickPlan, unofferedPlan } from '../lib/billing.js'
import { CONTACT_EMAIL } from '../lib/contact.js'
import { isEmail } from '../lib/email.js'
import { t, tp, getLang } from '../lib/i18n.js'
import Logo from '../components/Logo.jsx'
import { Button, CodeField } from '../components/ui.jsx'
import TermsConsent from '../components/TermsConsent.jsx'
import { offerPasskey } from '../components/AddPasskeySheet.jsx'
import { PlanPicker, planLabel, startCheckout } from './coach/billing.jsx'

/** Whether /#/start is a sign-up here: coaches may sign themselves up, to a paid plan or the Free one. */
export const startOpen = config => !!(config?.self_serve && config?.plans?.length)

/**
 * S4: a coach signing themselves up, from the site's pricing links (/#/start?plan=pro&period=month).
 * On the Free plan (`?plan=free`) there is no payment page: the account is the whole sign-up.
 * Account first, then the payment page: a 6-digit code mailed to the address makes the account
 * (CHW-368) — typed here, so it works inside Instagram's browser, where fitpal.ma's coaches tap
 * "Start free" and a passkey fails — and the checkout opens straight after. The passkey is offered
 * afterwards, where it can work (offerPasskey). A coach who closes the payment page has an account
 * with no plan, and Today offers "Choose a plan" from there.
 *
 * Only on an instance where startOpen() holds (App.jsx); everywhere else /start is the sign-in
 * screen, as it always was.
 */
export default function Start() {
  const loc = useLocation()
  const config = useStore(s => s.config)
  const { setUser, pushState, pullState } = useStore()
  const plans = config?.plans || []
  const [asked] = useState(() => new URLSearchParams(loc.search))
  const [choice, setChoice] = useState(() => pickPlan(plans, asked.get('plan'), asked.get('period')))
  const [picked, setPicked] = useState(false)  // the coach chose in the picker: the link's plan is behind them
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)   // the coach terms and processor agreement (CHW-357)
  const [sent, setSent] = useState(false)       // the code is on its way: the code step shows
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const codeRef = useRef(null)
  useEffect(() => { if (sent) setTimeout(() => codeRef.current?.focus(), 50) }, [sent])
  // The list is the server's; a link for a plan it stopped selling falls back rather than sticking —
  // keeping the period the link asked for, which pickPlan honours on whichever plan it lands.
  useEffect(() => {
    if (!choice || !plans.some(p => p.plan === choice.plan)) setChoice(pickPlan(plans, choice?.plan ?? asked.get('plan'), choice?.period ?? asked.get('period')))
  }, [plans])
  if (!choice) return null
  // A pricing card's plan that isn't sold here (CHW-371): say so, and what they start on instead.
  // With no paid plan on sale at all (billing off), paid plans are switched on by request.
  const notSold = !picked && unofferedPlan(plans, asked.get('plan'))
  const byRequest = !paidPlans(plans).length

  const toast = msg => useUI.getState().toast(msg)
  const send = async () => {
    const n = name.trim(), e = email.trim()
    if (!n) { toast(t('Enter a name')); return }
    // The server checks it properly; this only saves a mail to an obvious slip.
    if (!isEmail(e)) { toast(t('Enter your email address')); return }
    if (!agreed) { toast(t('Please accept the coach terms')); return }
    setBusy(true); setError(null)
    try { await coachSignupStart(n, e, getLang(), config.terms_version); setCode(''); setSent(true) }
    catch (err) { toast(err.message || t('Could not send the code')) }
    finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true); setError(null)
    let u
    try { u = await coachSignupVerify(email.trim(), code) }
    catch (err) { setError(err.status ? err.message : t('Could not connect')); setBusy(false); return }
    // Signed in from here on, whatever the payment page does: App moves to the coach's Today the
    // moment the user is set, and that is where a coach without a plan is offered one again.
    setUser(u)
    if (hasData(useStore.getState().S)) await pushState(); else await pullState()
    // Free has nothing to pay: the coach's Today is where the sign-up ends, with the passkey offer.
    if (choice.plan === 'free') { offerPasskey(); return }
    try { await startCheckout(choice.plan, choice.period) }
    catch (err) { toast(err.message || t('Could not open the payment page')) }
  }

  const footer = <div className="dim small" style={{ marginTop: 20 }}>
    {t('Already coaching here?')} <a href="#/home">{t('Sign in')}</a>
  </div>
  if (sent) return (
    <div className="narrow gate">
      <Logo size={40} heading />
      <div className="card" role="status" style={{ textAlign: 'left', marginTop: 18 }}>
        <div style={{ fontWeight: 600 }}>{t('Check your inbox')}</div>
        <div className="small muted" style={{ lineHeight: 1.38, margin: '4px 0 12px' }}>{t('A 6-digit code is on its way to {0}. Enter it here; it works once, for 15 minutes.', email.trim())}</div>
        <CodeField ref={codeRef} value={code} onChange={v => { setCode(v); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && !busy) verify() }} />
        {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
        <div style={{ height: 10 }} />
        <Button variant="primary" onClick={verify} disabled={busy || code.length !== 6}>
          {choice.plan === 'free'
            ? (busy ? t('Creating your account…') : t('Create my account'))
            : (busy ? t('Opening the payment page…') : t('Continue to payment'))}</Button>
        <div style={{ height: 8 }} />
        <Button onClick={send} disabled={busy}>{t('Send the code again')}</Button>
        <Button variant="ghost" className="dim" onClick={() => { setSent(false); setCode(''); setError(null) }}>{t('Use another address')}</Button>
      </div>
      {footer}
    </div>
  )

  return (
    <div className="narrow gate">
      <Logo size={40} heading />
      <div className="muted" style={{ marginBottom: 26 }}>{t('Coach your clients from one app.')}</div>
      <div className="card" style={{ textAlign: 'left' }}>
        <h2 style={{ margin: '0 0 10px' }}>{t('Your plan')}</h2>
        <PlanPicker plans={plans} value={choice} onChange={c => { setChoice(c); setPicked(true) }} />
        {notSold && <p className="small muted" role="note" style={{ lineHeight: 1.38, margin: '10px 0 0' }}>
          {tp(choice.cap, '{1} is not on sale online yet: you start on {2}, up to {0} active client.',
            '{1} is not on sale online yet: you start on {2}, up to {0} active clients.', planLabel(notSold), planLabel(choice.plan))}
          {byRequest && <>{' '}{t('During the launch, paid plans are switched on by request:')}{' '}
            <a href={'mailto:' + CONTACT_EMAIL}>{CONTACT_EMAIL}</a></>}</p>}
      </div>
      <div style={{ textAlign: 'left', marginTop: 6 }}>
        <input className="input" placeholder={t('Your name')} maxLength={40} autoComplete="name"
          value={name} onChange={ev => setName(ev.target.value)} />
        <div style={{ height: 10 }} />
        <input className="input" type="email" placeholder={t('Email')} maxLength={254} autoComplete="email"
          value={email} onChange={ev => setEmail(ev.target.value)} />
        <div className="dim small" style={{ margin: '6px 4px 0' }}>{t('For receipts, and to sign in: we email you a code.')}</div>
        <div style={{ marginTop: 14 }}><TermsConsent checked={agreed} onChange={setAgreed} id="start-terms" /></div>
        <div style={{ height: 14 }} />
        <Button variant="primary" icon="person" onClick={send} disabled={busy}>{busy ? t('Sending…') : t('Send me a code')}</Button>
      </div>
      {footer}
    </div>
  )
}
