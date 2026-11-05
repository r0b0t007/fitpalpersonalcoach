import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { isCoach } from '../lib/role.js'
import Logo from '../components/Logo.jsx'
import { Button, Notice } from '../components/ui.jsx'
import OpenInBrowser from '../components/OpenInBrowser.jsx'
import { savedRequest } from '../lib/join.js'
import { waLink } from '../lib/whatsapp.js'
import { PHOTOS_REACHABLE } from '../lib/photo.js'

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
 * it — and gives the app its own back after. Asking to join opens the join form (CHW-336), while the
 * server takes requests (`join_requests` in /api/config, off until the DPIA's conditions are met), and
 * not for a coach: the join form's claim would sign them out of their own account. A browser that
 * already asked is taken to its request whatever the switch says. WhatsApp, when the coach gave a
 * number, is the other way to reach them.
 */
export default function PublicCoach({ handle }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const [coach, setCoach] = useState(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setCoach(null); setError(null)
    // view=1: this screen is a view of the page, for the coach funnel's count (CHW-335); the join
    // form reads the same card without it. With the config, so the page's actions are drawn once:
    // a signed-in visitor gets here before boot has it, and a fetch that failed at boot is asked
    // again (loadConfig is cached, and null on a failure, which reads as closed).
    Promise.all([api('/api/public/coach?h=' + encodeURIComponent(handle) + '&view=1'), useStore.getState().loadConfig()])
      .then(([r, c]) => { if (live) { setConfig(c); setCoach(r.coach) } })
      .catch(e => { if (live) setError(e.message || t('Could not load this page')) })
    return () => { live = false }
  }, [handle])

  useCoachTheme(coach?.theme)

  if (error) return <div className="narrow gate">
    <Logo size={30} heading />
    <Notice icon="info" title={error} />
  </div>
  if (!coach) return <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}><Logo size={30} /></div>

  // The coach's face first (CHW-356), as the theme they picked draws it (designs 01.2, 01.3):
  // Sombre, the photo full-bleed across the top and the name over its fade; Clair, a round
  // portrait beside the name. No photo, the name alone, centred as before — as on the paired phone
  // app, whose <img> cannot reach the server (lib/photo.js PHOTOS_REACHABLE). Decorative beside the
  // name, so alt="": a screen reader says the name once.
  const photo = PHOTOS_REACHABLE ? coach.photo : null
  const hero = photo && coach.theme !== 'light'
  const asked = !!savedRequest(handle)
  const coachHere = isCoach(user)
  const canAsk = asked || (!!config?.join_requests && !coachHere)
  const inBrowser = !asked && <OpenInBrowser path={'/c/' + encodeURIComponent(handle)} style={{ marginBottom: 18 }} />
  return <div className={'narrow' + (photo ? '' : ' gate')} style={{ textAlign: 'left' }}>
    {hero && <div className="coach-hero">
      <img src={photo} alt="" />
      <h1>{coach.name}</h1>
    </div>}
    {/* Not once this browser has sent this coach a request: it is followed from this browser's
        storage, which Safari or Chrome would not have (as on the join form). */}
    {inBrowser}
    {!hero && photo && <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '24px 0 10px' }}>
      <img className="coach-portrait" src={photo} alt="" />
      <h1 style={{ margin: 0, minWidth: 0 }}>{coach.name}</h1>
    </div>}
    {!photo && <h1 style={{ marginBottom: 6 }}>{coach.name}</h1>}
    {coach.bio && <p className="muted" style={{ fontSize: 17, lineHeight: 1.4, marginTop: 0 }}>{coach.bio}</p>}
    {/* A shown page is an open one (the server answers a closed page with its refusal), so the
        way to ask is there whenever the server takes requests; a browser that already asked is
        taken to its request, which the join form follows from its own route even once requests
        close. With neither, WhatsApp is the page's one action, and stays primary. */}
    {(canAsk || coach.whatsapp) && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
      {canAsk && <Button variant="primary" onClick={() => nav('/join/' + encodeURIComponent(handle))}>{asked ? t('See my request') : t('Ask to join')}</Button>}
      {coach.whatsapp && <a className={'btn ' + (canAsk ? 'plain' : 'primary')} href={waLink(coach.whatsapp, t('Hello {0}, I found your page on FitPal', coach.name))} target="_blank" rel="noopener noreferrer">
        <span>{t('Message on WhatsApp')}</span></a>}
    </div>}
    {/* A coach previewing a page ("See my page"): the button followers get is not theirs to press. */}
    {coachHere && !asked && config?.join_requests && <div className="dim small" style={{ marginTop: 14 }}>{t('Followers see a button here to ask to join.')}</div>}
    <div className="dim small" style={{ marginTop: 28, textAlign: 'center' }}>{t('Coached with FitPal')}</div>
  </div>
}
