import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { MOBILE } from '../../lib/mobile.js'
import { t } from '../../lib/i18n.js'
import { useUI } from '../../store/useUI.js'
import { setShellPref } from '../../lib/role.js'
import { ACCENTS, accentName } from '../../lib/format.js'
import { Row, Section, Segmented } from '../../components/ui.jsx'
import { confirmSheet } from '../../sheets.jsx'
import { InviteSheet, MediaSheet } from './sheets.jsx'
import { PlanBillingSection } from './billing.jsx'
import { EmailRow } from './EmailRow.jsx'
import { billingOn } from '../../lib/billing.js'
import { PairSheet } from '../Settings.jsx'

/**
 * The coach's own screen: who they are, how they take clients on, and — only if they run the
 * instance — the two operator jobs that survive.
 *
 * `/account` used to render the client Settings screen, which is fifteen rows about how YOU train
 * (rest timers, plate maths, wake lock, equipment profiles, exports) and not one about coaching.
 * A coach looking for "how do I invite somebody" found a screen for somebody else's job, with a
 * row pointing at an Admin dashboard built to run a gym.
 *
 * Shares its keys with Settings wherever the words are the same (sign out, sign out everywhere,
 * Appearance), so a coach who flips to Train myself reads one name for one setting.
 */
export default function CoachAccount() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const signOut = useStore(s => s.signOut)
  const signOutAll = useStore(s => s.signOutAll)
  const disconnectServer = useStore(s => s.disconnectServer)
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const syncError = useStore(s => s.syncError)
  // The plan (R4). loadBilling asks nothing on an instance that bills nobody, and the section draws
  // nothing until there is an answer, so Account is unchanged on the Node API. Asked again when the
  // config lands: a returning coach is drawn from the cached user before /api/config answers.
  const billing = useStore(s => s.billing)
  const loadBilling = useStore(s => s.loadBilling)
  const billed = billingOn(useStore(s => s.config))
  useEffect(() => { loadBilling() }, [billed, user?.id])

  // Ends the profile's sessions on every device, this one included, so on success it lands where
  // a plain sign-out lands. On failure nothing local is touched: still signed in here, and say so
  // rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  const trainMyself = () => {
    // The client shell against the coach's OWN state. Not a different account and not a preview:
    // the coach trains here, and canCoachMember already refuses member.id === coach.id, so
    // nothing they do in it can reach a client.
    setShellPref('client')
    nav('/home')
  }

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('Account')}</h1>
        <div className="sub">{user?.name}</div></div>
    </div>

    <Section title={t('You')}>
      {/* The one place a refused save becomes visible. PUT /api/data's 413 writes this sentence
          for the person — what the limit is and what to do — so it is passed through untouched;
          a generic "sync failed" throws away the only part that says what to change. The push is
          debounced, so the failure lands while they are looking at something else, and this is
          the screen someone opens when the app feels wrong. */}
      {syncError && <Row icon="warning" iconTint="var(--red)" title={t('This device could not save to the server')} subtitle={syncError} />}
      <Row icon="personCircle" iconTint="var(--grey)" title={user?.name || t('Signed in')}
        subtitle={t('Signed in with a passkey.')} />
      <EmailRow />
      {/* Your own training settings — unit, language, notifications, rest timers, export. They are
          the client screen's, because they are the same settings a client has, and the coach shell
          would otherwise have no door to them at all. */}
      <Row icon="gear" iconTint="var(--grey)" title={t('Training settings')}
        subtitle={t('Units, language, notifications, and how a workout behaves.')} accessory="chevron"
        onClick={() => nav('/settings')} />
      {/* The paired mobile build is a different account screen. Offering to pair the phone you are
          holding is nonsense, and a plain sign-out there is a dead end: it clears the session but
          leaves the paired-server record, so the app lands on a passkey screen bound to
          capacitor://localhost — which cannot sign in to the coach's server — until the app is
          restarted. disconnectServer is the one that also forgets the pairing. */}
      {MOBILE
        ? <Row icon="signOut" iconTint="var(--red)" title={t('Disconnect from my server')} danger onClick={() => confirmSheet({
          title: t('Disconnect from your server?'),
          message: t('Your data is synced to your server first, then this device switches back to local-only. Your clients are not affected.'),
          confirmText: t('Disconnect'), danger: true,
          onConfirm: async () => { await disconnectServer(); nav('/home'); toast(t('Disconnected — back to local-only')) },
        })} />
        : <>
          <Row icon="link" iconTint="var(--blue)" title={t('Pair the mobile app')}
            subtitle={t('Connect the app on your phone to this account.')} accessory="chevron"
            onClick={() => openSheet(close => <PairSheet close={close} />)} />
          <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({
            title: t('Sign out?'),
            message: t('Your data is synced to your profile first, then cleared from this device. Your clients are not affected.'),
            confirmText: t('Sign out'), danger: true,
            onConfirm: () => { signOut(); nav('/home') },
          })} />
          <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')}
            subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
        </>}
    </Section>

    <PlanBillingSection billing={billing} />

    <Section title={t('Coaching')} footer={t('Everything you do for clients lives on the other three tabs. These are the pieces that belong to you rather than to one of them.')}>
      <Row icon="link" iconTint="var(--acc)" title={t('Invite a client')}
        subtitle={t('Make a link that puts whoever opens it on your roster.')} accessory="chevron"
        onClick={() => openSheet(() => <InviteSheet />)} />
      <Row icon="camera" iconTint="var(--indigo)" title={t('Exercise demos')}
        subtitle={t('Your own videos, shown to every client on that exercise.')} accessory="chevron"
        onClick={() => openSheet(() => <MediaSheet />)} />
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Train myself')}
        subtitle={t('Your own plan and workouts. Come back from the {0} tab.', t('You'))} accessory="chevron"
        onClick={trainMyself} />
    </Section>

    <Section title={t('Appearance')} footer={t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented className="seg-inline"
          options={[
            { value: 'dark', icon: 'moon', label: t('Dark') },
            { value: 'light', icon: 'sun', label: t('Light') },
            { value: 'system', icon: 'gear', label: t('System') },
          ]}
          value={S.theme || 'dark'} onChange={v => update(s => { s.theme = v })} />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'gold') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={accentName(k)} />
          ))}
        </div>
      </div>
    </Section>

    {/* Only for whoever runs the instance. A coach on somebody else's server has no business here
        and, more to the point, every route behind these two rows answers 403 to them — a door that
        opens onto a permission error is worse than no door. On the one-coach deployment this fork
        is for, the coach bootstrapped the instance and is the admin, so they see both. */}
    {user?.admin && <Section title={t('Business')} footer={t('The parts of running this instance that are still yours. Classes, timetables and access requests are gone — this is one coach and their clients, not a gym.')}>
      <Row icon="people" iconTint="var(--blue)" title={t('Accounts')}
        subtitle={t('Everyone with a profile here, and whether they can sign in.')} accessory="chevron"
        onClick={() => nav('/account/accounts')} />
      <Row icon="history" iconTint="var(--grey)" title={t('Activity log')}
        subtitle={t('Who signed in, what failed, what changed.')} accessory="chevron"
        onClick={() => nav('/account/activity')} />
    </Section>}

    <p className="sect-f">{'FitPal Coach'}{typeof __APP_VERSION__ === 'string' ? ' · ' + __APP_VERSION__ : ''}</p>
  </div>
}
