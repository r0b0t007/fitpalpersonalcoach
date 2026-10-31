import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyRegisterCoach, bioLabel } from '../lib/api.js'
import { pickPlan } from '../lib/billing.js'
import { isEmail } from '../lib/email.js'
import { t, getLang } from '../lib/i18n.js'
import Logo from '../components/Logo.jsx'
import { Button } from '../components/ui.jsx'
import { PlanPicker, startCheckout } from './coach/billing.jsx'

/** Whether /#/start is a sign-up here: an instance that bills and lets coaches sign themselves up. */
export const startOpen = config => !!(config?.billing && config?.self_serve && config?.plans?.length)

/**
 * S4: a coach signing themselves up, from the site's pricing links (/#/start?plan=pro&period=month).
 * Account first, then the payment page: the passkey makes the account, the server keeps the email
 * pending and mails the link that confirms it, and the checkout opens straight after. A coach who
 * closes the payment page has an account with no plan, and Today offers "Choose a plan" from there.
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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  // The list is the server's; a link for a plan it stopped selling falls back rather than sticking —
  // keeping the period the link asked for, which pickPlan honours on whichever plan it lands.
  useEffect(() => {
    if (!choice || !plans.some(p => p.plan === choice.plan)) setChoice(pickPlan(plans, choice?.plan ?? asked.get('plan'), choice?.period ?? asked.get('period')))
  }, [plans])
  if (!choice) return null

  const toast = msg => useUI.getState().toast(msg)
  const go = async () => {
    const n = name.trim(), e = email.trim()
    if (!n) { toast(t('Enter a name')); return }
    // The server checks it properly; this only saves a passkey prompt over an obvious slip.
    if (!isEmail(e)) { toast(t('Enter your email address')); return }
    setBusy(true)
    let u
    try { u = await passkeyRegisterCoach(n, e, getLang()) }
    catch (err) {
      setBusy(false)
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast(err.message || t('Registration failed'))
      return
    }
    // Signed in from here on, whatever the payment page does: App moves to the coach's Today the
    // moment the user is set, and that is where a coach without a plan is offered one again.
    setUser(u)
    if (hasData(useStore.getState().S)) await pushState(); else await pullState()
    try { await startCheckout(choice.plan, choice.period) }
    catch (err) { toast(err.message || t('Could not open the payment page')) }
  }

  return (
    <div className="narrow gate">
      <Logo size={40} heading />
      <div className="muted" style={{ marginBottom: 26 }}>{t('Coach your clients from one app.')}</div>
      <div className="card" style={{ textAlign: 'left' }}>
        <h2 style={{ margin: '0 0 10px' }}>{t('Your plan')}</h2>
        <PlanPicker plans={plans} value={choice} onChange={setChoice} trialDays={config?.trial_days} />
      </div>
      {webauthnOK() ? <div style={{ textAlign: 'left', marginTop: 6 }}>
        <input className="input" placeholder={t('Your name')} maxLength={40} autoComplete="name"
          value={name} onChange={ev => setName(ev.target.value)} />
        <div style={{ height: 10 }} />
        <input className="input" type="email" placeholder={t('Email')} maxLength={254} autoComplete="email"
          value={email} onChange={ev => setEmail(ev.target.value)} />
        <div className="dim small" style={{ margin: '6px 4px 0' }}>{t('For receipts and for signing in if you lose your passkey.')}</div>
        <div style={{ height: 14 }} />
        <Button variant="primary" icon="person" onClick={go} disabled={busy}>
          {busy ? t('Opening the payment page…') : t('Create passkey and continue')}</Button>
        <div className="dim small" style={{ marginTop: 8, textAlign: 'center' }}>{t('Passkeys use {0} — no passwords.', bioLabel())}</div>
      </div> : <div className="card small muted" style={{ textAlign: 'left' }}>
        {t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}
      </div>}
      <div className="dim small" style={{ marginTop: 20 }}>
        {t('Already coaching here?')} <a href="#/home">{t('Sign in')}</a>
      </div>
    </div>
  )
}
