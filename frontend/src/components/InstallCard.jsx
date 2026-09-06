// Dismissible install offer — a card, not an auto-opened sheet, matching the project's stance
// on unsolicited modals (see the coach-offer comment in views/Home.jsx): arriving to a modal you
// didn't ask for is a bad way to be told. Renders on Login (first-time visitors) and Home
// (returning users who never see Login).
import { t } from '../lib/i18n.js'
import { BRAND } from '../lib/brand.js'
import { shouldOfferInstall, installPath, manualInstallHint, promptInstall, snoozeInstall, useInstallPrompt } from '../lib/install.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The one click handler behind every "Install" control — this card's button and the row in
// Settings — so outcome feedback and error handling cannot diverge between them. Ignores the
// click event it is handed.
export async function installViaPrompt() {
  try {
    const outcome = await promptInstall()
    if (outcome === 'accepted') useUI.getState().toast(t('Installing {0}…', BRAND))
  } catch (e) { useUI.getState().toast(e.message || t('Could not start the install')) }
}

export default function InstallCard({ style } = {}) {
  useInstallPrompt()   // re-render when the deferred prompt arrives, is consumed, or is snoozed
  if (!shouldOfferInstall()) return null
  const path = installPath()
  // Only a real prompt or Safari's share sheet earn a card. On Android Chrome the event normally
  // lands within seconds, so the manual "⋮ menu" hint would only flash before the button replaces
  // it — Settings keeps that hint for the case where the event never comes.
  if (path !== 'prompt' && path !== 'ios') return null

  return (
    <div className="card" style={{ borderColor: 'var(--acc)', textAlign: 'left', ...style }}>
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <span className="lrow-i"><Icon name="download" /></span>
        <div className="big" style={{ fontSize: 22 }}>{t('Install {0}', BRAND)}</div>
      </div>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {path === 'prompt'
          ? t('Get the full-screen app on your home screen.')
          : manualInstallHint(path) + ' ' + t('to install {0} as a full-screen app.', BRAND)}
      </div>
      {path === 'prompt' && <Button variant="primary" icon="download" onClick={installViaPrompt}>{t('Install')}</Button>}
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={snoozeInstall}>{t('Not now')}</Button>
    </div>
  )
}
