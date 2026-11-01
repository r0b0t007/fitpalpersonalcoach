import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Logo from '../components/Logo.jsx'
import { Button, Notice } from '../components/ui.jsx'

/**
 * A coach's public page (CHW-330): where the link in their Instagram bio lands, through the server's
 * /c/<handle> (preview tags for the crawlers) and on to here. Anyone may see it, signed in or not.
 * It wears the coach's chosen theme (CHW-323) while open and gives the app its own back after.
 * "Ask to join" leads into the join flow (CHW-336).
 */
export default function PublicCoach({ handle }) {
  const nav = useNavigate()
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

  useEffect(() => {
    if (!coach) return
    const de = document.documentElement
    const before = de.dataset.theme
    de.dataset.theme = coach.theme === 'light' ? 'light' : 'dark'
    return () => { de.dataset.theme = before }
  }, [coach?.theme])

  if (error) return <div className="narrow gate">
    <Logo size={30} heading />
    <Notice icon="info" title={error} />
  </div>
  if (!coach) return <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}><Logo size={30} /></div>

  return <div className="narrow gate" style={{ textAlign: 'left' }}>
    <h1 style={{ marginBottom: 6 }}>{coach.name}</h1>
    {coach.bio && <p className="muted" style={{ fontSize: 17, lineHeight: 1.4, marginTop: 0 }}>{coach.bio}</p>}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
      <Button variant="primary" onClick={() => nav('/join/' + coach.handle)}>{t('Ask to join')}</Button>
      {coach.whatsapp && <a className="btn plain" href={'https://wa.me/' + coach.whatsapp} target="_blank" rel="noopener noreferrer">
        <span>{t('Message on WhatsApp')}</span></a>}
    </div>
    <div className="dim small" style={{ marginTop: 28, textAlign: 'center' }}>{t('Coached with FitPal')}</div>
  </div>
}
