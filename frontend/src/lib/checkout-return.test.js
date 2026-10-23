// @vitest-environment happy-dom
//
// Back from the payment page. The parameters only decide whether Today says "Setting up your
// plan…"; what matters is that they survive until the plan lands and do not outlive it.
import { describe, it, expect, beforeEach } from 'vitest'
import { pendingCheckout, clearCheckout, resetCheckoutForTest } from './checkout-return.js'

const at = href => { history.replaceState(null, '', href); resetCheckoutForTest() }

beforeEach(() => at('/'))

describe('pendingCheckout', () => {
  it('reads the checkout Creem appended to the success URL', () => {
    at('/?checkout_id=ch_123&order_id=ord_1&signature=abc')
    expect(pendingCheckout()).toBe('ch_123')
  })

  it('is empty on an ordinary visit', () => {
    expect(pendingCheckout()).toBe('')
  })

  it('reads once, and never touches the address bar by itself', () => {
    at('/?checkout_id=ch_123#/today')
    expect(pendingCheckout()).toBe('ch_123')
    // The hash router moving on must not lose it: the cache answers, the URL is left alone.
    history.replaceState(null, '', '/#/clients')
    expect(pendingCheckout()).toBe('ch_123')
  })
})

describe('clearCheckout', () => {
  it("strips every parameter Creem added, and keeps the rest of the address", () => {
    at('/?checkout_id=ch_1&order_id=o&customer_id=c&subscription_id=s&product_id=p&request_id=r&signature=x&invite=KEEP#/today')
    pendingCheckout()
    clearCheckout()
    expect(location.search).toBe('?invite=KEEP')
    expect(location.hash).toBe('#/today')
    expect(pendingCheckout()).toBe('')
  })

  it('leaves an address without them as it was', () => {
    at('/coach/#/account')
    clearCheckout()
    expect(location.pathname + location.search + location.hash).toBe('/coach/#/account')
  })
})
