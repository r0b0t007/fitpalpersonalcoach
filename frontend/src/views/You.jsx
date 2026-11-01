import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { Section, Row } from '../components/ui.jsx'
import { isCoach, setShellPref, homeFor } from '../lib/role.js'
import { can } from '../lib/features.js'

// The hub the tab bar gained when it lost two of its six cells.
//
// It is deliberately thin. Everything here was already reachable — Stats and Exercises had tabs of
// their own, Settings hung off Home's gear, and the two dashboards sat three taps down inside it —
// so this screen is about where things live, not new function. It does not repeat Home's cards:
// Home answers "what am I doing today", this answers "everything else about me".
export default function You() {
  const nav = useNavigate()
  const user = useStore(s => s.user)

  return <div className="narrow">
    <div className="hdr">
      {/* No stand-in when signed out: a guest has no name, and inventing a label for that state
          would be a new string in eleven packs to say nothing. */}
      <div><h1>{t('You')}</h1>{user && <div className="sub">{user.name}</div>}</div>
    </div>

    {/* This screen only renders in the training shell, so a coach seeing it is one who chose
        "Train myself" (lib/role.js). The way back sits above their own things, where the Staff
        section used to put the dashboards before the two shells were split. */}
    {isCoach(user) && (
      <Section>
        <Row icon="figureStrength" iconTint="var(--acc)" title={t('Back to coaching')}
          accessory="chevron" onClick={() => { setShellPref('coach'); nav(homeFor(user, 'coach')) }} />
      </Section>
    )}

    <Section title={t('Training')}>
      <Row icon="chart" iconTint="var(--blue)" title={t('Stats')}
        subtitle={t('Progress & history')} accessory="chevron" onClick={() => nav('/stats')} />
      <Row icon="history" iconTint="var(--grey)" title={t('History')}
        accessory="chevron" onClick={() => nav('/history')} />
      {/* Not on Home and not a tab: eating is a several-times-a-day job, but it is not what the
          app is for, and a tracker that opens on food is one people stop opening. */}
      <Row icon="flame" iconTint="var(--orange)" title={t('Nutrition')}
        accessory="chevron" onClick={() => nav('/nutrition')} />
      {/* Kept one tap from a tab even though it left the bar: it is a reference catalogue, but a
          1,324-entry one that people do browse. */}
      {can(user, 'library') && <Row icon="list" iconTint="var(--teal)" title={t('Exercises')}
        accessory="chevron" onClick={() => nav('/library')} />}
    </Section>

    <Section>
      <Row icon="gear" iconTint="var(--grey)" title={t('Settings')}
        subtitle={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')} accessory="chevron" onClick={() => nav('/settings')} />
    </Section>
  </div>
}
