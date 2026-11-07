// @vitest-environment happy-dom
//
// The "Refer a coach" card (CHW-350): the coach's referral link and its counts, or the way to get one.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let ANSWER = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async path => { if (path === '/api/coach/referrals') return ANSWER; throw new Error('unexpected ' + path) },
}))
const { default: ReferralCard } = await import('./ReferralCard.jsx')

let container, root
const text = () => container.textContent
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = async () => { await act(async () => { root.render(<MemoryRouter><ReferralCard /></MemoryRouter>) }) }

describe('the referral card', () => {
  it('asks a coach with no page to publish one first', async () => {
    ANSWER = { handle: null, signedUp: 0, activated: 0 }
    await render()
    expect(text()).toContain('Publish your page to get your referral link.')
    expect(text()).not.toContain('fitpal.ma/?ref=')
  })

  it("shows a coach's link and their counts, with no names", async () => {
    ANSWER = { handle: 'yasmine.fit', signedUp: 2, activated: 1 }
    window.happyDOM.setURL('https://coach.fitpal.ma/')
    await render()
    expect(text()).toContain('https://fitpal.ma/?ref=yasmine.fit')
    expect(text()).toContain('Signed up: 2 · Active: 1')
  })
})
