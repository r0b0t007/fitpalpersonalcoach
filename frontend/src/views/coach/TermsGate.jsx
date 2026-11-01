import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { getLang, t } from '../../lib/i18n.js'
import { termsUrl } from '../../lib/terms.js'
import { Button, Check, Notice } from '../../components/ui.jsx'
import Logo from '../../components/Logo.jsx'

/**
 * The coach terms, before the coach's app (CHW-357): a coach who has not accepted the current
 * version — one from before there were terms, or before this version — is asked once, here. What
 * they accept is the processor agreement for their clients' data, so it comes before their roster.
 * If the server cannot be asked (offline), the app opens as before: the gate never locks a coach
 * out of what is already on their phone.
 */
export default function TermsGate({ children }) {
  const [terms, setTerms] = useState(null)   // {version, accepted} once read
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    api('/api/coach/terms').then(r => { if (live) setTerms(r) }).catch(() => { if (live) setTerms({ accepted: true }) })
    return () => { live = false }
  }, [])

  if (!terms || terms.accepted) return children

  const accept = async () => {
    if (!agreed) { setError(t('Please accept the coach terms')); return }
    setBusy(true); setError(null)
    try { setTerms(await api('/api/coach/terms', { method: 'POST', body: JSON.stringify({ version: terms.version }) })) }
    catch (e) { setError(e.message); setBusy(false) }
  }

  return <div className="narrow gate" style={{ textAlign: 'left' }}>
    <Logo size={30} heading />
    <h2 style={{ margin: '18px 0 8px' }}>{t('Our terms, and your clients’ data')}</h2>
    <p className="muted">{t('You decide what happens to your clients’ data; FitPal keeps it for you and does nothing else with it. The coach terms set this out, with the data processing agreement the law requires between us.')}</p>
    <a href={termsUrl(getLang())} target="_blank" rel="noopener noreferrer">{t('Read the coach terms')}</a>
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 18 }}>
      <Check checked={agreed} onChange={v => { setAgreed(v); setError(null) }} labelledBy="terms-agree" />
      <div id="terms-agree" className="small" onClick={() => { setAgreed(!agreed); setError(null) }}>{t('I accept the coach terms and the data processing agreement')}</div>
    </div>
    {error && <div style={{ marginTop: 12 }}><Notice icon="warning" tone="warn" title={error} /></div>}
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={accept} disabled={busy}>{t('Accept and continue')}</Button>
  </div>
}
