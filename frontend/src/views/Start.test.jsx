// @vitest-environment happy-dom
//
// The coach sign-up screen, reached from fitpal.ma's pricing cards. A card's plan that the server
// doesn't sell lands somewhere else, on Free while billing is off: the screen says so (CHW-371).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { _setLangState } from '../lib/i18n-core.js'
import fr from '../locales/fr.js'

const { default: Start } = await import('./Start.jsx')
const { useStore } = await import('../store/useStore.js')

const FREE = { plan: 'free', cap: 3, periods: [] }
const SOLO = { plan: 'solo', cap: 10, periods: ['month', 'year'] }
const PRO = { plan: 'pro', cap: 30, periods: ['month', 'year'] }
const FREE_ONLY = { billing: false, plans: [FREE], free_cap: 3, self_serve: true, terms_version: '2026-11-06' }
const SELLING = { ...FREE_ONLY, billing: true, plans: [FREE, SOLO, PRO] }

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
afterEach(() => {
  act(() => root.unmount()); container.remove(); useStore.setState({ config: null })
  _setLangState('en', null, null, null)
})

describe('coach sign-up from a pricing link', () => {
  it('says a paid plan is not on sale yet, what the coach gets instead, and whom to write to', async () => {
    await render(FREE_ONLY, '?plan=solo&period=month')
    expect(text()).toContain('Solo is not on sale online yet: you start on Free, up to 3 active clients.')
    expect(text()).toContain('During the launch, paid plans are switched on by request:')
    expect(container.querySelector('a[href="mailto:contact@fitpal.ma"]')).not.toBe(null)
  })

  it('names Free in the coach\'s language, as the picker above it does', async () => {
    _setLangState('fr', fr, null, null)
    await render(FREE_ONLY, '?plan=pro&period=month')
    expect(text()).toContain('Pro n’est pas encore en vente en ligne : vous commencez sur la formule Gratuit, jusqu’à 3 clients actifs.')
    expect(text()).not.toMatch(/\bFree\b/)
  })

  it('with billing on, names the fallback and does not send the coach to e-mail', async () => {
    await render(SELLING, '?plan=studio&period=month')
    expect(text()).toContain('Studio is not on sale online yet: you start on Pro, up to 30 active clients.')
    expect(text()).not.toContain('by request')
    expect(container.querySelector('a[href^="mailto:"]')).toBe(null)
  })

  it('drops the note once the coach picks a plan themselves', async () => {
    await render(SELLING, '?plan=studio&period=month')
    const solo = [...container.querySelectorAll('.seg button')].find(b => b.textContent === 'Solo')
    await act(async () => { solo.click() })
    expect(text()).not.toContain('not on sale')
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
