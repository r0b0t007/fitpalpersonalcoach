import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { Button, Notice } from '../../components/ui.jsx'
import Logo from '../../components/Logo.jsx'
import TermsConsent from '../../components/TermsConsent.jsx'

/**
 * Whether this coach has accepted the coach terms in force (CHW-357): null while asking, then
 * {version, accepted, ...} from the server. Held by App, which stays mounted across routes, so a
 * tab change neither asks again nor shows a coach screen before the answer. If the server cannot
 * be asked (offline), the app opens as before: the terms never lock a coach out of what is
 * already on their phone.
 */
export function useCoachTerms(enabled, userId) {
  const [terms, setTerms] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    setTerms(null)
    api('/api/coach/terms').then(r => { if (live) setTerms(r) }).catch(() => { if (live) setTerms({ accepted: true }) })
    return () => { live = false }
  }, [enabled, userId])
  return [terms, setTerms]
}

/**
 * The terms screen, in place of the coach's app until they accept: what they accept is the
 * processor agreement for their clients' data, so it comes before their roster. A coach who does
 * not accept is told how to leave with their clients' data, as the terms promise.
 */
export default function TermsGate({ terms, onChange }) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const accept = async () => {
    if (!agreed) { setError(t('Please accept the coach terms')); return }
    setBusy(true); setError(null)
    try { onChange(await api('/api/coach/terms', { method: 'POST', body: JSON.stringify({ version: terms.version }) })) }
    catch (e) {
      setError(e.message); setBusy(false)
      // A newer version was published while this screen was open: ask for it, to be read again.
      if (e.status === 409) { setAgreed(false); api('/api/coach/terms').then(onChange).catch(() => {}) }
    }
  }

  return <div className="narrow gate" style={{ textAlign: 'left' }}>
    <Logo size={30} heading />
    <h2 style={{ margin: '18px 0 8px' }}>{t('Our terms, and your clients’ data')}</h2>
    <p className="muted">{t('You decide what happens to your clients’ data; FitPal keeps it for you and does nothing else with it. The coach terms set this out, with the data processing agreement the law requires between us.')}</p>
    <div style={{ marginTop: 18 }}>
      <TermsConsent checked={agreed} onChange={v => { setAgreed(v); setError(null) }} id="terms-agree" />
    </div>
    {error && <div style={{ marginTop: 12 }}><Notice icon="warning" tone="warn" title={error} /></div>}
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={accept} disabled={busy}>{t('Accept and continue')}</Button>
    <p className="dim small" style={{ marginTop: 18 }}>
      {t("If you do not accept them, write to {0}: we close your account and send you your clients' data.", 'contact@fitpal.ma')}
    </p>
  </div>
}

/** What the coach shell shows while the terms are being asked for: nothing of the roster yet. */
export function TermsWaiting() {
  return <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}><Logo size={30} /></div>
}
