import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { billingState, pickPlan, planName } from '../../lib/billing.js'
import { fmtDate, isoOf } from '../../lib/format.js'
import { t, tp } from '../../lib/i18n.js'
import { Button, Notice, Row, Section, Segmented } from '../../components/ui.jsx'

// The coach's plan on screen (R4; designs S4, C20, C21): the plan picker the sign-up and "Choose a
// plan" share, the banner on Today and the Plan & billing section on Account. What state to draw
// is lib/billing.js's; this file only draws it and sends the coach to Creem.
//
// No prices anywhere: they live on the payment page, so the app can never show a stale one. The
// public prices are fitpal.ma's (CHW-318); the app states only what it can read from the server —
// the plan, its client cap and the trial.

// With the year when it is more than about half a year away: a yearly plan's "Renews 20 Oct" a
// year out otherwise reads as next week.
const day = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return fmtDate(isoOf(d), false, Math.abs(d.getTime() - Date.now()) > 180 * 86_400_000)
}
const periodName = p => (p === 'year' ? t('yearly') : t('monthly'))

/** Leaves for Creem's checkout page. The coach comes back to /?checkout_id=… (lib/checkout-return.js). */
export async function startCheckout(plan, period) {
  const { url } = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, period }) })
  location.assign(url)
}

/** Leaves for Creem's customer portal: the card, the invoices, a plan change or a cancellation. */
export async function openPortal() {
  try {
    const { url } = await api('/api/billing/portal', { method: 'POST', body: '{}' })
    location.assign(url)
  } catch (e) { useUI.getState().toast(e.message || t('Could not open the billing page')) }
}

/** What a banner's or a row's button does — see banner() in lib/billing.js. */
export function runBillingAction(action) {
  if (action === 'choose') useUI.getState().openSheet(close => <PlanSheet close={close} />)
  else if (action) openPortal()
}

/**
 * The plan and the period, and what they mean (S4's card). `plans` is /api/config's list; `value`
 * is pickPlan()'s {plan, period}.
 */
export function PlanPicker({ plans, value, onChange, trialDays }) {
  const current = plans.find(p => p.plan === value.plan) || plans[0]
  const periods = current?.periods || []
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Segmented options={plans.map(p => ({ value: p.plan, label: planName(p.plan) }))} value={value.plan}
      onChange={plan => onChange(pickPlan(plans, plan, value.period))} />
    <div className="muted">{t('Up to {0} active clients', current?.cap)}</div>
    {/* A plan sold in one period only has nothing to choose. */}
    {periods.length > 1 && <Segmented options={periods.map(p => ({ value: p, label: p === 'year' ? t('Yearly') : t('Monthly') }))}
      value={value.period} onChange={period => onChange(pickPlan(plans, value.plan, period))} />}
    {trialDays > 0 && <div className="dim small">{t('{0} days free, then billed by Creem. Cancel any time from Account.', trialDays)}</div>}
  </div>
}

/** S4b: the plan card alone, for a coach who is signed in and has no plan. */
export function PlanSheet({ close }) {
  const config = useStore(s => s.config)
  const plans = config?.plans || []
  const [choice, setChoice] = useState(() => pickPlan(plans))
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await startCheckout(choice.plan, choice.period) }
    catch (e) { useUI.getState().toast(e.message || t('Could not open the payment page')); setBusy(false) }
  }
  if (!choice) return <>
    <h3>{t('Choose a plan')}</h3>
    <div className="muted small">{t('No plans are on sale here right now.')}</div>
  </>
  return <>
    <h3>{t('Choose a plan')}</h3>
    <div className="card">
      <PlanPicker plans={plans} value={choice} onChange={setChoice} trialDays={config?.trial_days} />
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Opening the payment page…') : t('Continue to payment')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Not now')}</Button>
  </>
}

// The banner's look per state. A state that needs the coach (payment, pause, cap) takes the same
// tone InviteBlocked gives it, so one coach never sees the same state tinted in one place only.
const BANNER_LOOK = {
  none: { icon: 'sparkles', tint: 'var(--label-3)' }, trialing: { icon: 'sparkles', tint: 'var(--acc)' },
  past_due: { icon: 'warning', tone: 'warn' }, paused: { icon: 'pause', tone: 'warn' }, over_cap: { icon: 'people', tone: 'caution' },
}

/** C21: one card between Today's title and its tiles. `b` is banner()'s answer, never null here. */
export function BillingBanner({ b, billing }) {
  const config = useStore(s => s.config)
  const e = billing?.entitlement
  // The trial is the server's to state (config.trial_days); none promised when it offers none.
  const trial = config?.trial_days > 0
  const copy = {
    activating: [t('Setting up your plan…'), t('This takes a few seconds.')],
    none: [t('Choose a plan to start coaching'), trial
      ? t('Inviting clients and sending programs open as soon as you pick one. {0} days free.', config.trial_days)
      : t('Inviting clients and sending programs open as soon as you pick one.')],
    trialing: [b.daysLeft > 0 ? tp(b.daysLeft, 'Free trial · {0} day left', 'Free trial · {0} days left') : t('Free trial · ends today'),
      t('Your {0} plan starts on {1}.', planName(e?.plan), day(e?.trialEndsAt))],
    past_due: [t('Payment didn’t go through'), t('It will be retried automatically. Everything keeps working meanwhile.')],
    paused: [t('Your plan is paused'), t('Clients can still train. Inviting, sending programs and uploading demos are paused.')],
    over_cap: [t('{0} active clients on a {1}-client plan', b.used, b.cap), b.granted
      ? t('Everyone keeps training. Ask FitPal for a larger plan to invite more.')
      : t('Everyone keeps training. Upgrade to invite more.')],
  }[b.kind]
  const label = { choose: t('Choose a plan'), manage: t('Manage billing'), update: t('Update payment'), upgrade: t('Upgrade') }[b.action]
  return <Notice role="status" {...BANNER_LOOK[b.kind]} busy={b.kind === 'activating'} title={copy[0]} body={copy[1]}>
    {label && <Button variant="tinted" size="xs" onClick={() => runBillingAction(b.action)}>{label}</Button>}
  </Notice>
}

/**
 * C22: the invite sheet's card when the coach takes no more clients. `reason` is the server's
 * (coach/invites): `at_cap` — every seat taken; `read_only` — the plan does not write, paused or
 * none at all, which /billing/me tells apart (its fix is the card, or choosing a plan).
 */
export function InviteBlocked({ reason, cap, used, onManageClients }) {
  const billing = useStore(s => s.billing)
  const loadBilling = useStore(s => s.loadBilling)
  useEffect(() => { if (!billing) loadBilling() }, [])
  const state = billingState(billing)

  // The same reading as Today's banner (banner(): `granted`, and a portal action only with a
  // portal), so the two never disagree about one coach. A plan granted by hand has no portal to
  // upgrade in: the larger plan is the owner's to give. Until /billing/me answers the copy is the
  // ordinary one, and the button waits for a portal to exist.
  const granted = state === 'granted'
  if (reason === 'at_cap') return <Notice tone="caution" icon="people" wide
    title={tp(cap, 'Your plan allows {0} client', 'Your plan allows {0} clients')} body={granted
      ? tp(used, 'You have {0} active client. Ask FitPal for a larger plan — or release a client who has stopped training, from their page: that frees a seat.',
        'You have {0} active clients. Ask FitPal for a larger plan — or release a client who has stopped training, from their page: that frees a seat.')
      : tp(used, 'You have {0} active client. Upgrade to invite more — or release a client who has stopped training, from their page: that frees a seat.',
        'You have {0} active clients. Upgrade to invite more — or release a client who has stopped training, from their page: that frees a seat.')}>
    {!granted && billing?.portal && <Button variant="primary" onClick={openPortal}>{t('Upgrade')}</Button>}
    <Button onClick={onManageClients}>{t('Manage clients')}</Button>
  </Notice>

  return <Notice tone="warn" icon="pause" wide title={t('Inviting is paused')}
    body={t('Inviting opens again once billing is sorted out.')}>
    {state === 'none'
      ? <Button variant="primary" onClick={() => runBillingAction('choose')}>{t('Choose a plan')}</Button>
      : billing?.portal && <Button variant="primary" onClick={openPortal}>{t('Update payment')}</Button>}
  </Notice>
}

/**
 * C20: Account's "Plan & billing". Nothing for a coach the plan does not apply to (an admin, an
 * instance that bills nobody), and nothing before /billing/me has answered — an empty section that
 * fills in a beat later reads as "no plan".
 */
export function PlanBillingSection({ billing }) {
  const config = useStore(s => s.config)
  const state = billingState(billing)
  if (!state || state === 'exempt') return null
  const e = billing.entitlement
  const l = billing.licence
  const plans = billing.plans?.length ? billing.plans : (config?.plans || [])
  const footer = plans.length ? t('Plans differ only by active clients: {0}.', plans.map(p => planName(p.plan) + ' ' + p.cap).join(', ')) : null
  const seats = e.cap ? t('{0} / {1} clients', e.used, e.cap) : null
  const title = l?.period ? planName(e.plan) + ' · ' + periodName(l.period) : planName(e.plan)
  const manage = sub => billing.portal && <Row icon="gear" iconTint="var(--grey)" title={t('Manage billing')} subtitle={sub}
    accessory="chevron" onClick={openPortal} />

  if (state === 'none') return <Section title={t('Plan & billing')} footer={footer}>
    <Row icon="sparkles" iconTint="var(--acc)" title={t('No plan yet')} subtitle={t('Choose a plan to invite clients and send programs')}
      accessory="chevron" onClick={() => runBillingAction('choose')} />
    {/* An ended plan still has its invoices in the portal. */}
    {manage(t('Invoices from your earlier plan'))}
  </Section>

  if (state === 'paused') return <Section title={t('Plan & billing')} footer={footer}>
    <Row icon="pause" iconTint="var(--orange)" title={title} subtitle={t('Paused — your clients can still train')} value={seats} />
    <Row icon="warning" iconTint="var(--orange)" title={t('Billing needs attention')}
      subtitle={t('You can see everything, but inviting, sending programs and uploading demos are paused until the payment goes through.')} />
    {/* The fix is past_due's row: the same action looks the same in both states. */}
    {billing.portal && <Row icon="gear" iconTint="var(--grey)" title={t('Update payment')}
      subtitle={t('Payment method, invoices, change plan or cancel')} accessory="chevron" onClick={openPortal} />}
  </Section>

  if (state === 'granted') return <Section title={t('Plan & billing')} footer={footer}>
    <Row icon="sparkles" iconTint="var(--acc)" title={planName(e.plan)} subtitle={t('Granted by FitPal')} value={seats} />
  </Section>

  const sub = {
    trialing: t('Free trial · ends {0}', day(e.trialEndsAt)),
    active: e.periodEnd ? t('Renews {0}', day(e.periodEnd)) : null,
    cancelling: t('Ends {0} — you cancelled; everything works until then', day(l?.cancelAt || e.periodEnd || e.trialEndsAt)),
    past_due: t('Payment didn’t go through — it will be retried automatically'),
  }[state]
  return <Section title={t('Plan & billing')} footer={footer}>
    <Row icon={state === 'past_due' ? 'warning' : 'sparkles'} iconTint={state === 'past_due' ? 'var(--orange)' : 'var(--acc)'}
      title={title} subtitle={sub} value={seats} />
    {state === 'past_due'
      ? billing.portal && <Row icon="gear" iconTint="var(--grey)" title={t('Update payment')}
        subtitle={t('Payment method, invoices, change plan or cancel')} accessory="chevron" onClick={openPortal} />
      : manage(state === 'cancelling' ? t('Resume, or change plan') : t('Payment method, invoices, change plan or cancel'))}
  </Section>
}
