// @vitest-environment happy-dom
//
// The coach sign-up screen, reached from fitpal.ma's pricing cards. While billing is off the
// server sells only Free, so a "Choose Solo" link lands on Free: the screen says so (CHW-371).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const { default: Start } = await import('./Start.jsx')
const { useStore } = await import('../store/useStore.js')

const FREE_ONLY = { billing: false, plans: [{ plan: 'free', cap: 3, periods: [] }], free_cap: 3, self_serve: true, terms_version: '2026-11-06' }
const SELLING = { ...FREE_ONLY, billing: true, plans: [...FREE_ONLY.plans, { plan: 'solo', cap: 10, periods: ['month', 'year'] }] }

let container, root
const text = () => container.textContent
const render = async (config, search) => {
  useStore.setState({ config })
  await act(async () => { root.render(<MemoryRouter initialEntries={['/start' + search]}><Start /></MemoryRouter>) })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); useStore.setState({ config: null }) })

describe('coach sign-up from a pricing link', () => {
  it('says a paid plan is not on sale yet, what the coach gets instead, and whom to write to', async () => {
    await render(FREE_ONLY, '?plan=solo&period=month')
    expect(text()).toContain('Solo is not on sale online yet: you start on Free, up to 3 clients.')
    expect(text()).toContain('During the launch, paid plans are switched on by request:')
    expect(container.querySelector('a[href="mailto:contact@fitpal.ma"]')).not.toBe(null)
  })

  it('says nothing on a Free link', async () => {
    await render(FREE_ONLY, '?plan=free')
    expect(text()).toContain('Free')
    expect(text()).not.toContain('not on sale')
  })

  it('says nothing once billing is on and the plan is sold', async () => {
    await render(SELLING, '?plan=solo&period=month')
    expect(text()).toContain('Solo')
    expect(text()).not.toContain('not on sale')
  })
})
