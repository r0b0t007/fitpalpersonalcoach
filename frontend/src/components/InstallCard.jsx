// Dismissible install offer — a card, not an auto-opened sheet, matching the project's stance
// on unsolicited modals (see the coach-offer comment in views/Home.jsx): arriving to a modal you
// didn't ask for is a bad way to be told. Renders on Login (first-time visitors) and Home
// (returning users who never see Login).
import { t } from '../lib/i18n.js'
import { BRAND } from '../lib/brand.js'
import { IS_IOS } from '../lib/api.js'
import { shouldOfferInstall, canPrompt, promptInstall, snoozeInstall, useInstallPrompt } from '../lib/install.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

export default function InstallCard({ style } = {}) {
  useInstallPrompt()   // re-render when the deferred prompt arrives, is consumed, or is snoozed
  if (!shouldOfferInstall()) return null
  const prompt = canPrompt()
  // Nothing to offer: no captured prompt (Firefox, or Chrome hasn't fired it yet) and not iOS
  // Safari either — there is no install path to show.
  if (!prompt && !IS_IOS) return null

  const onInstall = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') useUI.getState().toast(t('Installing {0}…', BRAND))
  }

  return (
    <div className="card" style={{ borderColor: 'var(--acc)', textAlign: 'left', ...style }}>
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <span className="lrow-i"><Icon name="download" /></span>
        <div className="big" style={{ fontSize: 22 }}>{t('Install {0}', BRAND)}</div>
      </div>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {prompt
          ? t('Get the full-screen app on your home screen.')
          : t('In Safari: Share → Add to Home Screen') + ' ' + t('to install {0} as a full-screen app.', BRAND)}
      </div>
      {prompt && <Button variant="primary" icon="download" onClick={onInstall}>{t('Install')}</Button>}
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={snoozeInstall}>{t('Not now')}</Button>
    </div>
  )
}
