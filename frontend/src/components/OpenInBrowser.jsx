import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { browserUrl, inAppName, inAppPlatform } from '../lib/inapp.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// CHW-332: inside Instagram's browser (or Facebook's, TikTok's) a calm card suggesting the phone's
// own browser, where the app installs and a passkey works. A suggestion, never a wall: the email
// code works in here, so nobody has to leave to finish. "Not now" holds for this visit only
// (sessionStorage), as each new tap from the bio is a new visit.
//
// `path` is where the browser lands: a plain path with no #/ route (the intent link cannot carry
// one), so the public page /c/<handle>, or / for Login.
const KEY = 'gym_inapp_later'
const later = () => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } }

export default function OpenInBrowser({ path = '/', style }) {
  const platform = inAppPlatform()
  const [hidden, setHidden] = useState(later)
  if (!platform || hidden) return null
  const name = inAppName()
  const browser = platform === 'android' ? 'Chrome' : 'Safari'
  const href = browserUrl(window.location.origin + path, platform)
  const dismiss = () => { try { sessionStorage.setItem(KEY, '1') } catch { /* this visit only anyway */ } setHidden(true) }
  return <div className="card" role="note" style={{ textAlign: 'left', ...style }}>
    <div className="row" style={{ gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
      <span className="lrow-i"><Icon name="globe" /></span>
      <div>
        <div style={{ fontWeight: 600 }}>{name ? t('You are in {0}’s browser', name) : t('You are in an app’s browser')}</div>
        <div className="muted small" style={{ marginTop: 4, lineHeight: 1.4 }}>
          {t('You can carry on here. In {0} you can also add the app to your home screen and sign in faster next time.', browser)}
        </div>
      </div>
    </div>
    {href && <a className="btn tinted" href={href} style={{ marginTop: 6 }}><span>{t('Open in {0}', browser)}</span></a>}
    <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.4 }}>
      {href ? t('If nothing happens: tap ··· in the corner, then open in your browser.') : t('Tap ··· in the corner, then open in your browser.')}
    </div>
    <Button variant="ghost" className="dim" onClick={dismiss} style={{ marginTop: 4 }}>{t('Not now')}</Button>
  </div>
}
