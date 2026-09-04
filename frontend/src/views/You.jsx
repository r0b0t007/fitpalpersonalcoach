import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { openCoachOffer } from '../sheets.jsx'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { Section, Row } from '../components/ui.jsx'

// The hub the tab bar gained when it lost two of its six cells.
//
// It is deliberately thin. Everything here was already reachable — Stats and Exercises had tabs of
// their own, Settings hung off Home's gear, and the two dashboards sat three taps down inside it —
// so this screen is about where things live, not new function. It does not repeat Home's cards:
// Home answers "what am I doing today", this answers "everything else about me".
export default function You() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const assignments = useStore(s => s.assignments)
  const offer = assignments?.[0]

  return <div className="narrow">
    <div className="hdr">
      {/* No stand-in when signed out: a guest has no name, and inventing a label for that state
          would be a new string in eleven packs to say nothing. */}
      <div><h1>{t('You')}</h1>{user && <div className="sub">{user.name}</div>}</div>
    </div>

    {/* Running the club is a daily job, so it sits above the member's own things rather than
        three taps down inside Settings, where it used to be. Its own section so a coach who is
        also a member does not have to pick their dashboard out of a list of preferences.
        The dashboards themselves are English-only by choice; these labels never were, and are
        translated in all 11 packs, so they keep using those keys. */}
    {(user?.admin || user?.coach) && (
      <Section title={t('Staff')}>
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')}
          accessory="chevron" onClick={() => nav('/admin')} />}
        {user.coach && <Row icon="figureStrength" iconTint="var(--indigo)" title={t('Coach dashboard')}
          accessory="chevron" onClick={() => nav('/coach')} />}
      </Section>
    )}

    {/* Before this the offer existed only as a card on Home, so a member anywhere else in the app
        had no idea one was waiting. The tab carries a dot for the same reason. */}
    {offer && (
      <Section title={t('Waiting for you')}>
        <Row icon="clipboard" iconTint="var(--acc)" title={t('{0} sent you a program', offer.coachName)}
          subtitle={offer.note || t('Tap to review it.')} accessory="chevron" onClick={() => openCoachOffer(offer)} />
      </Section>
    )}

    <Section title={t('Training')}>
      <Row icon="chart" iconTint="var(--blue)" title={t('Stats')}
        subtitle={t('Progress & history')} accessory="chevron" onClick={() => nav('/stats')} />
      <Row icon="history" iconTint="var(--grey)" title={t('History')}
        accessory="chevron" onClick={() => nav('/history')} />
      {/* Kept one tap from a tab even though it left the bar: it is a reference catalogue, but a
          1,324-entry one that people do browse. */}
      <Row icon="list" iconTint="var(--teal)" title={t('Exercises')}
        accessory="chevron" onClick={() => nav('/library')} />
    </Section>

    <Section>
      <Row icon="gear" iconTint="var(--grey)" title={t('Settings')}
        subtitle={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')} accessory="chevron" onClick={() => nav('/settings')} />
    </Section>
  </div>
}
