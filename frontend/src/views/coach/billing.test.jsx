// @vitest-environment happy-dom
//
// The coach's plan on screen (R4): Today's banner, Account's Plan & billing and the sign-up at
// /#/start. Production runs the Node API until R5, and its /api/config has no `billing` — the
// first thing pinned here is that none of this shows, or even asks, there.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let ME = null   // /api/billing/me, or a function of the call count
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/coach/members') return { members: [] }
    if (path === '/api/coach/programs') return { programs: [] }
    if (path === '/api/billing/me') return typeof ME === 'function' ? ME() : ME
    if (path === '/api/billing/checkout') return { url: 'https://checkout.creem.test/ch_1' }
    if (path === '/api/billing/portal') return { url: 'https://portal.creem.test/c_1' }
    throw new Error('unexpected ' + path)
  },
  webauthnOK: () => true,
  passkeyRegisterCoach: async (name, email, lang) => { calls.push(['register', { name, email, lang }]); return { id: 'u1', name, coach: true } },
  fetchExerciseMedia: async () => [],
}))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { default: CoachToday } = await import('./CoachToday.jsx')
const { default: CoachAccount } = await import('./CoachAccount.jsx')
const { default: Start, startOpen } = await import('../Start.jsx')
const { resetCheckoutForTest } = await import('../../lib/checkout-return.js')

const PLANS = [
  { plan: 'solo', cap: 10, periods: ['month', 'year'] },
  { plan: 'pro', cap: 30, periods: ['month', 'year'] },
  { plan: 'studio', cap: 75, periods: ['month', 'year'] },
]
const NODE_CONFIG = { invite_only: true, allow_guest: false }   // what the Node API sends: no billing at all
const BILLED = { invite_only: true, billing: true, self_serve: true, plans: PLANS, trial_days: 14 }
const COACH = { id: 'me', name: 'Ahmed', coach: true }
const inDays = d => new Date(Date.now() + d * 86_400_000).toISOString()
const me = (entitlement = {}, licence = null, portal = true) => ({
  entitlement: { status: 'active', plan: 'pro', cap: 30, used: 12, canWrite: true, canTakeClient: true, overCap: false, trialEndsAt: null, periodEnd: inDays(20), ...entitlement },
  licence: { status: entitlement.status || 'active', plan: 'pro', period: 'month', source: 'creem', cancelAt: null, ...licence }, plans: PLANS, portal,
})

let container, root, assign
const text = () => container.textContent
const billingCalls = () => calls.filter(([p]) => p.startsWith('/api/billing/'))
const render = async (el, path = '/') => {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>) })
  await act(async () => {})   // let the effects' requests land
}
const click = async label => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent.trim() === label)
  if (!b) throw new Error('no button ' + label + ' in: ' + text())
  await act(async () => { b.click() })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  ME = null
  history.replaceState(null, '', '/')
  resetCheckoutForTest()
  assign = vi.spyOn(location, 'assign').mockImplementation(() => {})
  useStore.setState({ user: COACH, config: BILLED, billing: null })
  useUI.setState({ sheets: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); assign.mockRestore() })

describe('on the Node API (no billing in /api/config)', () => {
  it('Today asks nothing about a plan and shows no banner', async () => {
    useStore.setState({ config: NODE_CONFIG })
    ME = me({ status: 'none', canWrite: false })
    await render(<CoachToday />)
    expect(billingCalls()).toEqual([])
    expect(text()).not.toContain('Choose a plan')
  })

  it('Account has no Plan & billing section', async () => {
    useStore.setState({ config: NODE_CONFIG })
    await render(<CoachAccount />)
    expect(billingCalls()).toEqual([])
    expect(text()).not.toContain('Plan & billing')
  })

  it('/start is not a sign-up there', () => {
    expect(startOpen(NODE_CONFIG)).toBe(false)
    expect(startOpen({ ...BILLED, self_serve: false })).toBe(false)
    expect(startOpen({ ...BILLED, billing: false, plans: [] })).toBe(false)
    expect(startOpen(BILLED)).toBe(true)
  })
})

describe("Today's banner", () => {
  it('offers a plan to a coach without one, and the sheet it opens', async () => {
    ME = me({ status: 'none', plan: null, cap: 0, canWrite: false }, { status: 'pending' })
    await render(<CoachToday />)
    expect(text()).toContain('Choose a plan to start coaching')
    expect(text()).toContain('14 days free')
    await click('Choose a plan')
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('says nothing to a coach who is paying', async () => {
    ME = me({ status: 'active' })
    await render(<CoachToday />)
    expect(container.querySelector('[role="status"]')).toBe(null)
  })

  it('sends a failed payment to the portal', async () => {
    ME = me({ status: 'past_due' })
    await render(<CoachToday />)
    expect(text()).toContain('Payment didn’t go through')
    await click('Update payment')
    await act(async () => {})
    expect(calls.some(([p]) => p === '/api/billing/portal')).toBe(true)
    expect(assign).toHaveBeenCalledWith('https://portal.creem.test/c_1')
  })

  it('asks for a bigger grant, with no portal button, when a granted plan is over its cap', async () => {
    ME = me({ status: 'manual', plan: 'solo', cap: 10, used: 12, overCap: true }, { source: 'manual', period: null }, false)
    await render(<CoachToday />)
    expect(text()).toContain('Ask FitPal for a larger plan')
    expect(container.querySelector('[role="status"] button')).toBe(null)
  })

  it('names the overage on a plan below the roster', async () => {
    ME = me({ status: 'active', plan: 'solo', cap: 10, used: 12, overCap: true })
    await render(<CoachToday />)
    expect(text()).toContain('12 active clients on a 10-client plan')
  })

  it('shows "Setting up your plan…" back from the payment page while the plan is pending', async () => {
    history.replaceState(null, '', '/?checkout_id=ch_1&signature=x')
    ME = me({ status: 'none', plan: null, cap: 0, canWrite: false }, { status: 'pending' })
    await render(<CoachToday />)
    expect(text()).toContain('Setting up your plan…')
    expect(text()).not.toContain('Choose a plan to start coaching')
    // Still waiting: the address keeps the checkout, so a reload still knows.
    expect(location.search).toContain('checkout_id=ch_1')
  })

  it('drops "activating" and tidies the address once the plan is in', async () => {
    history.replaceState(null, '', '/?checkout_id=ch_1&signature=x#/today')
    ME = me({ status: 'trialing', trialEndsAt: inDays(14) })
    await render(<CoachToday />)
    expect(text()).not.toContain('Setting up your plan…')
    expect(location.search).toBe('')
    expect(location.hash).toBe('#/today')
  })
})

describe('loadBilling', () => {
  it('drops an answer that lands after the coach signed out', async () => {
    let answer
    ME = () => new Promise(r => { answer = r })
    const pending = useStore.getState().loadBilling()
    useStore.getState().setUser(null)
    answer(me({ status: 'active' }))
    expect(await pending).toBe(null)
    expect(useStore.getState().billing).toBe(null)
  })
})

describe('a returning coach, drawn before /api/config answers', () => {
  // The cached user puts them in the coach shell at once; the config follows a beat later.
  it('Account asks for the plan once the config says the instance bills', async () => {
    useStore.setState({ config: null })
    ME = me({ status: 'trialing', trialEndsAt: inDays(3) })
    await render(<CoachAccount />)
    expect(text()).not.toContain('Plan & billing')
    await act(async () => { useStore.setState({ config: BILLED }) })
    await act(async () => {})
    expect(text()).toContain('Plan & billing')
  })

  it('Today still waits for the plan when back from the payment page', async () => {
    history.replaceState(null, '', '/?checkout_id=ch_1')
    useStore.setState({ config: null })
    ME = me({ status: 'none', plan: null, cap: 0, canWrite: false }, { status: 'pending' })
    await render(<CoachToday />)
    await act(async () => { useStore.setState({ config: BILLED }) })
    await act(async () => {})
    expect(text()).toContain('Setting up your plan…')
  })
})

describe('Account › Plan & billing', () => {
  it('shows a trial with its end, the seats and Manage billing', async () => {
    ME = me({ status: 'trialing', trialEndsAt: inDays(3) })
    await render(<CoachAccount />)
    expect(text()).toContain('Plan & billing')
    expect(text()).toContain('Pro · monthly')
    expect(text()).toContain('Free trial · ends')
    expect(text()).toContain('12 / 30 clients')
    expect(text()).toContain('Manage billing')
    expect(text()).toContain('Plans differ only by active clients: Solo 10, Pro 30, Studio 75.')
  })

  it('offers a plan, and no portal, to a coach who never paid', async () => {
    ME = me({ status: 'none', plan: null, cap: 0, canWrite: false }, { status: 'pending' }, false)
    await render(<CoachAccount />)
    expect(text()).toContain('No plan yet')
    expect(text()).not.toContain('Manage billing')
  })

  it('puts the card first when the plan is paused', async () => {
    ME = me({ status: 'paused', canWrite: false })
    await render(<CoachAccount />)
    expect(text()).toContain('Billing needs attention')
    expect(text()).toContain('Update payment')
  })

  it('has nothing to manage on a granted plan', async () => {
    ME = me({ status: 'manual' }, { source: 'manual', period: null })
    await render(<CoachAccount />)
    expect(text()).toContain('Granted by FitPal')
    expect(text()).not.toContain('Manage billing')
  })

  it('says nothing to an admin, whom no plan limits', async () => {
    ME = me({ status: 'admin', plan: null, cap: null })
    await render(<CoachAccount />)
    expect(text()).not.toContain('Plan & billing')
  })
})

describe('/#/start', () => {
  const type = async (placeholder, value) => {
    const input = container.querySelector(`input[placeholder="${placeholder}"]`)
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }

  beforeEach(() => useStore.setState({ user: null }))

  it('preselects the plan and period from the pricing link', async () => {
    await render(<Start />, '/start?plan=solo&period=year')
    expect(text()).toContain('Up to 10 active clients')
    expect(container.querySelector('.seg button.on').textContent).toBe('Solo')
    expect([...container.querySelectorAll('.seg button.on')].map(b => b.textContent)).toEqual(['Solo', 'Yearly'])
  })

  it('keeps the period of a link whose plan is not sold here', async () => {
    await render(<Start />, '/start?plan=team&period=year')
    expect([...container.querySelectorAll('.seg button.on')].map(b => b.textContent)).toEqual(['Pro', 'Yearly'])
  })

  it('falls back to Pro, monthly, for a link that names nothing', async () => {
    await render(<Start />, '/start')
    expect([...container.querySelectorAll('.seg button.on')].map(b => b.textContent)).toEqual(['Pro', 'Monthly'])
  })

  it('makes the account with its email, then opens the payment page for the plan chosen', async () => {
    await render(<Start />, '/start?plan=studio&period=month')
    await type('Your name', 'Ahmed')
    await type('Email', 'ahmed@example.com')
    await click('Create passkey and continue')
    await act(async () => {})
    expect(calls.find(([p]) => p === 'register')[1]).toEqual({ name: 'Ahmed', email: 'ahmed@example.com', lang: expect.any(String) })
    expect(useStore.getState().user).toMatchObject({ id: 'u1', coach: true })
    expect(calls.find(([p]) => p === '/api/billing/checkout')[1]).toEqual({ plan: 'studio', period: 'month' })
    expect(assign).toHaveBeenCalledWith('https://checkout.creem.test/ch_1')
  })

  it('asks for an email before any passkey prompt', async () => {
    await render(<Start />, '/start')
    await type('Your name', 'Ahmed')
    await type('Email', 'not-an-address')
    await click('Create passkey and continue')
    expect(calls.find(([p]) => p === 'register')).toBe(undefined)
  })
})
