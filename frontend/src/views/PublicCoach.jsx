import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import Logo from '../components/Logo.jsx'
import { Notice } from '../components/ui.jsx'
import OpenInBrowser from '../components/OpenInBrowser.jsx'
import { savedRequest } from '../lib/join.js'

/**
 * Wears a coach's chosen theme (CHW-323) while the screen is open, handed to App through useUI,
 * which applies it; leaving hands the person's own back. Undefined (not loaded yet): nothing.
 * Shared by the public page and the join flow, so the two never disagree about it.
 */
export function useCoachTheme(theme) {
  useEffect(() => {
    if (!theme) return
    useUI.setState({ themeOverride: theme === 'light' ? 'light' : 'dark' })
    return () => useUI.setState({ themeOverride: null })
  }, [theme])
}

/**
 * A coach's public page (CHW-330): where the link in their Instagram bio lands, through the server's
 * /c/<handle> (preview tags for the crawlers) and on to here. Anyone may see it, signed in or not.
 * It wears the coach's chosen theme (CHW-323) while open — handed to App through useUI, which applies
 * it — and gives the app its own back after. The way to ask to join arrives with the join flow
 * (CHW-336); until then WhatsApp is the way to reach the coach.
 */
export default function PublicCoach({ handle }) {
  const [coach, setCoach] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setCoach(null); setError(null)
    api('/api/public/coach?h=' + encodeURIComponent(handle))
      .then(r => { if (live) setCoach(r.coach) })
      .catch(e => { if (live) setError(e.message || t('Could not load this page')) })
    return () => { live = false }
  }, [handle])

  useCoachTheme(coach?.theme)

  if (error) return <div className="narrow gate">
    <Logo size={30} heading />
    <Notice icon="info" title={error} />
  </div>
  if (!coach) return <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}><Logo size={30} /></div>

  return <div className="narrow gate" style={{ textAlign: 'left' }}>
    {/* Not once this browser has sent this coach a request: it is followed from this browser's
        storage, which Safari or Chrome would not have (as on the join form). */}
    {!savedRequest(handle) && <OpenInBrowser path={'/c/' + encodeURIComponent(handle)} style={{ marginBottom: 18 }} />}
    <h1 style={{ marginBottom: 6 }}>{coach.name}</h1>
    {coach.bio && <p className="muted" style={{ fontSize: 17, lineHeight: 1.4, marginTop: 0 }}>{coach.bio}</p>}
    {coach.whatsapp && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
      <a className="btn primary" href={'https://wa.me/' + coach.whatsapp} target="_blank" rel="noopener noreferrer">
        <span>{t('Message on WhatsApp')}</span></a>
    </div>}
    <div className="dim small" style={{ marginTop: 28, textAlign: 'center' }}>{t('Coached with FitPal')}</div>
  </div>
}
