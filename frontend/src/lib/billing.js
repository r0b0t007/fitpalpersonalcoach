// A coach's plan as the app shows it (R4; the Laravel API only). GET /api/billing/me answers with
// the server's own reading — `entitlement`, the rule the API enforces — and the licence row behind
// it; this file turns that into the one state each screen draws and the one action it offers.
// Nothing here decides what a coach may do: a refused request is refused by the server whatever
// this says, and the worst a wrong answer here can do is show the wrong card.
//
// Off entirely on an instance with no plans: its /api/config has neither `billing` nor a
// `free_cap` (nor had the Node API's), so every caller asks plansOn() first and the app is exactly
// what it was without them. A Free plan (CHW-329) turns this on even with Creem off.

/** The trial banner only shows in its last days: a coach two weeks out has nothing to do yet. */
export const TRIAL_WARN_DAYS = 3

const DAY = 86_400_000

/** Whether coaches have plans here: Creem billing, or the Free plan's cap. */
export const plansOn = config => !!config?.billing || config?.free_cap > 0

/** The plans a coach can buy: everything offered but Free. */
export const paidPlans = plans => (Array.isArray(plans) ? plans.filter(p => p.plan !== 'free') : [])

/**
 * Where the coach stands, one word per card the designs draw (C20, C21):
 *
 *   exempt     — an admin, a client, or an instance that bills nobody: no section, no banner
 *   none       — never paid, a checkout abandoned, a plan that ended or was revoked
 *   free       — the Free plan (CHW-329): writable, up to its cap, no payment involved
 *   trialing   — in the free trial
 *   active     — paid and renewing
 *   cancelling — paid, cancelled, still writing until the period ends
 *   past_due   — a renewal failed; Creem retries, everything still works
 *   paused     — the retries ran out (paused, unpaid): read-only until the card is updated
 *   granted    — a plan the owner gave by hand; nothing to pay or manage
 *
 * `canWrite` is the server's verdict and wins over the status: a licence the stale net caught, or
 * one on a plan this instance no longer sells, writes nothing whatever it is called, and is drawn
 * as "no plan yet" — the state whose action is to choose one.
 */
export function billingState(me) {
  const e = me?.entitlement
  if (!e) return null
  if (e.status === 'admin' || e.status === 'unlicensed' || e.status === 'client') return 'exempt'
  if (e.status === 'free') return 'free'
  // Paused before the canWrite test: it is read-only by definition, and its fix is the card, not
  // a new plan (the server refuses a second checkout while the subscription can still bill).
  if (e.status === 'paused' || e.status === 'unpaid') return 'paused'
  if (!e.canWrite) return 'none'
  if (e.status === 'manual') return 'granted'
  if (e.status === 'past_due') return 'past_due'
  // Creem's scheduled cancellation arrives with a cancel date on whatever the status was — a trial
  // cancelled in the portal stays `trialing` — and a finished one as `canceled`, which still writes
  // until period_end. Before the trial: a cancelled trial is not about to "start" anything.
  if (e.status === 'canceled' || me.licence?.cancelAt) return 'cancelling'
  if (e.status === 'trialing') return 'trialing'
  return 'active'
}

/**
 * Calendar days from today to `iso`'s day, in the coach's own time zone: a trial that ends tonight
 * is 0 ("ends today"), tomorrow at any hour 1. Never below 0; null without a date.
 */
export function daysLeft(iso, now = Date.now()) {
  const at = Date.parse(iso || '')
  if (Number.isNaN(at)) return null
  const midnight = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  return Math.max(0, Math.round((midnight(at) - midnight(now)) / DAY))
}

/** Back from the payment page and the webhook has landed: a plan that is neither "none" nor Free. */
export const checkoutSettled = me => {
  const s = billingState(me)
  return s !== null && s !== 'none' && s !== 'free'
}

/**
 * The single banner Today shows (C21), or null. One at a time, in this order: activating while
 * the app waits on the payment page's return, even though the plan does not write yet; then
 * paused, payment failed, no plan, over the cap, and the trial only in its last days; a Free coach
 * sees only the over-cap card, whose action is choosing a paid plan. Active and granted plans show
 * none.
 *
 * `action` is what the banner's button does: choose (the plan sheet, then the payment page),
 * manage, update or upgrade (all three are Creem's portal — the card, the invoices and the plan
 * change all live there in v1). A portal action needs a Creem customer (`portal` in billing/me):
 * without one — a plan granted by hand — there is no button, and the over-cap card says to ask for
 * a bigger plan instead (`granted`).
 */
export function banner(me, { activating = false, now = Date.now() } = {}) {
  const state = billingState(me)
  if (activating && (state === null || state === 'none' || state === 'free')) return { kind: 'activating', action: null }
  if (state === null || state === 'exempt') return null
  const e = me.entitlement
  const portal = act => (me.portal ? act : null)
  if (state === 'paused') return { kind: 'paused', action: portal('update') }
  if (state === 'past_due') return { kind: 'past_due', action: portal('update') }
  if (state === 'none') return { kind: 'none', action: 'choose' }
  // Free over its cap: a paid plan is the way up — chosen here, since there is no subscription to
  // change in a portal — and nothing to press on an instance that sells none.
  if (state === 'free') return e.overCap ? { kind: 'over_cap', action: paidPlans(me.plans).length ? 'choose' : null, used: e.used, cap: e.cap, granted: false } : null
  if (e.overCap) return { kind: 'over_cap', action: portal('upgrade'), used: e.used, cap: e.cap, granted: state === 'granted' }
  if (state === 'trialing') {
    const d = daysLeft(e.trialEndsAt, now)
    if (d !== null && d <= TRIAL_WARN_DAYS) return { kind: 'trialing', action: portal('manage'), daysLeft: d }
  }
  return null
}

/**
 * The plan and period to preselect, from a link (`?plan=pro&period=month`) or nothing: what was
 * asked for when this instance sells it, else Pro, else the first plan offered; the period asked
 * for when that plan has it, else monthly, else its first. `plans` is /api/config's list:
 * [{plan, cap, periods}]. Null when nothing is offered.
 */
export function pickPlan(plans, plan, period) {
  if (!Array.isArray(plans) || !plans.length) return null
  const p = plans.find(x => x.plan === plan) || plans.find(x => x.plan === 'pro') || plans[0]
  const periods = Array.isArray(p.periods) ? p.periods : []
  const per = periods.includes(period) ? period : periods.includes('month') ? 'month' : periods[0]
  return { plan: p.plan, period: per, cap: p.cap }
}

/** "pro" → "Pro". Plan names are the product's, the same in every language. */
export const planName = plan => (plan ? plan[0].toUpperCase() + plan.slice(1) : '')
