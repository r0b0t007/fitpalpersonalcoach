// Which card a coach sees about their plan. The server enforces the plan; this only picks the
// card and its one action, but a wrong pick sends a paying coach to "choose a plan" or tells a
// lapsed one nothing at all, so every state the designs draw is pinned here.
import { describe, it, expect } from 'vitest'
import { billingOn, billingState, banner, daysLeft, checkoutSettled, pickPlan, planName, TRIAL_WARN_DAYS } from './billing.js'

// Local times: the trial countdown is in calendar days where the coach is.
const NOW = new Date(2026, 8, 10, 9, 0).getTime()
const inDays = d => new Date(NOW + d * 86_400_000).toISOString()

// /api/billing/me as the Laravel API sends it, with the entitlement's defaults for a paying coach.
const me = (entitlement = {}, licence = null) => ({
  entitlement: { status: 'active', plan: 'pro', cap: 30, used: 12, canWrite: true, canTakeClient: true, overCap: false, trialEndsAt: null, periodEnd: inDays(20), ...entitlement },
  licence, plans: [], portal: true,
})

describe('billingOn', () => {
  it('is off when /api/config has no billing at all (or could not be read)', () => {
    expect(billingOn({ invite_only: false })).toBe(false)
    expect(billingOn(null)).toBe(false)
  })
  it('is off when Laravel says the instance bills nobody, on when it bills', () => {
    expect(billingOn({ billing: false })).toBe(false)
    expect(billingOn({ billing: true })).toBe(true)
  })
})

describe('billingState', () => {
  it('has nothing to say before the answer arrives', () => {
    expect(billingState(null)).toBe(null)
  })

  it('leaves admins, clients and an unbilled instance alone', () => {
    for (const status of ['admin', 'client', 'unlicensed']) expect(billingState(me({ status, canWrite: true }))).toBe('exempt')
  })

  it('reads each licence the designs draw', () => {
    expect(billingState(me({ status: 'trialing' }))).toBe('trialing')
    expect(billingState(me({ status: 'active' }))).toBe('active')
    expect(billingState(me({ status: 'past_due' }))).toBe('past_due')
    expect(billingState(me({ status: 'manual' }))).toBe('granted')
  })

  it('draws a cancellation still running as "cancelling", whichever way Creem said it', () => {
    expect(billingState(me({ status: 'canceled' }))).toBe('cancelling')
    // scheduled_cancel: still `active`, with the date it stops.
    expect(billingState(me({ status: 'active' }, { status: 'active', cancelAt: inDays(20) }))).toBe('cancelling')
    // A trial cancelled in the portal stays `trialing`: it is not about to "start" anything.
    expect(billingState(me({ status: 'trialing', trialEndsAt: inDays(2) }, { status: 'trialing', cancelAt: inDays(2) }))).toBe('cancelling')
  })

  it('draws a subscription out of retries as paused, not as "no plan"', () => {
    // Its fix is the card in the portal; the server refuses a second checkout meanwhile.
    expect(billingState(me({ status: 'paused', canWrite: false }))).toBe('paused')
    expect(billingState(me({ status: 'unpaid', canWrite: false }))).toBe('paused')
  })

  it('draws everything that writes nothing as "no plan yet"', () => {
    expect(billingState(me({ status: 'none', plan: null, cap: 0, canWrite: false }))).toBe('none')
    expect(billingState(me({ status: 'pending', canWrite: false }))).toBe('none')
    expect(billingState(me({ status: 'expired', canWrite: false }))).toBe('none')
    expect(billingState(me({ status: 'revoked', canWrite: false }))).toBe('none')
    expect(billingState(me({ status: 'canceled', canWrite: false }))).toBe('none')
  })

  it("believes the server's canWrite over the status", () => {
    // The stale net (a Creem row nobody has heard of for weeks) and a grant on a plan no longer
    // sold both keep their status and write nothing.
    expect(billingState(me({ status: 'past_due', canWrite: false }))).toBe('none')
    expect(billingState(me({ status: 'manual', canWrite: false }))).toBe('none')
  })
})

describe('banner', () => {
  const at = (m, opts) => banner(m, { now: NOW, ...opts })

  it('shows "activating" while back from the payment page and the plan has not landed', () => {
    expect(at(me({ status: 'pending', canWrite: false }), { activating: true })).toEqual({ kind: 'activating', action: null })
    // Before /billing/me has even answered.
    expect(at(null, { activating: true })).toEqual({ kind: 'activating', action: null })
  })

  it('stops activating the moment the plan is in', () => {
    expect(at(me({ status: 'trialing', trialEndsAt: inDays(14) }), { activating: true })).toBe(null)
  })

  it('offers each state its one action', () => {
    expect(at(me({ status: 'none', canWrite: false }))).toEqual({ kind: 'none', action: 'choose' })
    expect(at(me({ status: 'past_due' }))).toEqual({ kind: 'past_due', action: 'update' })
    expect(at(me({ status: 'paused', canWrite: false }))).toEqual({ kind: 'paused', action: 'update' })
    expect(at(me({ status: 'active', plan: 'solo', cap: 10, used: 12, overCap: true }))).toEqual({ kind: 'over_cap', action: 'upgrade', used: 12, cap: 10, granted: false })
  })

  it('offers no portal button to a coach with no Creem customer', () => {
    const noPortal = m => ({ ...m, portal: false })
    expect(at(noPortal(me({ status: 'past_due' })))).toEqual({ kind: 'past_due', action: null })
    // A grant over its cap: nothing to buy in the portal, so the card asks for a bigger grant.
    expect(at(noPortal(me({ status: 'manual', plan: 'solo', cap: 10, used: 12, overCap: true }))))
      .toEqual({ kind: 'over_cap', action: null, used: 12, cap: 10, granted: true })
  })

  it('puts paused, then payment failed, then no plan, before the cap', () => {
    expect(at(me({ status: 'paused', canWrite: false, overCap: true })).kind).toBe('paused')
    expect(at(me({ status: 'past_due', overCap: true })).kind).toBe('past_due')
    expect(at(me({ status: 'none', canWrite: false, overCap: true })).kind).toBe('none')
  })

  it('warns about the trial only in its last days', () => {
    expect(at(me({ status: 'trialing', trialEndsAt: inDays(10) }))).toBe(null)
    expect(at(me({ status: 'trialing', trialEndsAt: inDays(TRIAL_WARN_DAYS) }))).toEqual({ kind: 'trialing', action: 'manage', daysLeft: 3 })
    // Tonight is today, and the banner says so before it is over, not after.
    expect(at(me({ status: 'trialing', trialEndsAt: new Date(2026, 8, 10, 23, 0).toISOString() })).daysLeft).toBe(0)
    expect(at(me({ status: 'trialing', trialEndsAt: new Date(2026, 8, 11, 8, 0).toISOString() })).daysLeft).toBe(1)
  })

  it('says nothing to a paying, cancelling or granted coach, or to anyone exempt', () => {
    expect(at(me({ status: 'active' }))).toBe(null)
    expect(at(me({ status: 'canceled' }))).toBe(null)
    expect(at(me({ status: 'manual' }))).toBe(null)
    expect(at(me({ status: 'admin', overCap: false }))).toBe(null)
  })
})

describe('daysLeft', () => {
  it('counts calendar days, never goes below zero, and has no answer without a date', () => {
    expect(daysLeft(new Date(2026, 8, 12, 23, 59).toISOString(), NOW)).toBe(2)
    expect(daysLeft(new Date(2026, 8, 13, 0, 1).toISOString(), NOW)).toBe(3)
    expect(daysLeft(inDays(-1), NOW)).toBe(0)
    expect(daysLeft(null, NOW)).toBe(null)
  })
})

describe('checkoutSettled', () => {
  it('is settled once the plan is anything but "none"', () => {
    expect(checkoutSettled(null)).toBe(false)
    expect(checkoutSettled(me({ status: 'pending', canWrite: false }))).toBe(false)
    expect(checkoutSettled(me({ status: 'trialing' }))).toBe(true)
  })
})

describe('pickPlan', () => {
  const plans = [
    { plan: 'solo', cap: 10, periods: ['month', 'year'] },
    { plan: 'pro', cap: 30, periods: ['month', 'year'] },
    { plan: 'studio', cap: 75, periods: ['year'] },
  ]

  it('takes the plan and period from the link', () => {
    expect(pickPlan(plans, 'solo', 'year')).toEqual({ plan: 'solo', period: 'year', cap: 10 })
  })

  it('falls back to Pro, monthly, for a link that names nothing or nothing sold here', () => {
    expect(pickPlan(plans, null, null)).toEqual({ plan: 'pro', period: 'month', cap: 30 })
    expect(pickPlan(plans, 'enterprise', 'week')).toEqual({ plan: 'pro', period: 'month', cap: 30 })
  })

  it("keeps a plan's own periods", () => {
    expect(pickPlan(plans, 'studio', 'month')).toEqual({ plan: 'studio', period: 'year', cap: 75 })
  })

  it('takes the first plan when Pro is not sold, and nothing when nothing is', () => {
    expect(pickPlan([plans[0]], null, null)).toEqual({ plan: 'solo', period: 'month', cap: 10 })
    expect(pickPlan([], 'pro', 'month')).toBe(null)
    expect(pickPlan(undefined)).toBe(null)
  })
})

describe('planName', () => {
  it('capitalises the plan, and is empty without one', () => {
    expect(planName('studio')).toBe('Studio')
    expect(planName(null)).toBe('')
  })
})
