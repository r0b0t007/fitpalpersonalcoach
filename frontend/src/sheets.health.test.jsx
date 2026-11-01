// @vitest-environment happy-dom
//
// Health data a coached client logs (CHW-360): check-ins, weigh-ins, measurements, meals and photos
// open only once the client has agreed that their coach sees them; a workout starts without the
// weigh-in instead of asking every time; withdrawing deletes the data on the device too.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const calls = []
let CONSENT = null
vi.mock('./lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/me/health-consent' && !opts) return CONSENT
    if (path === '/api/me/health-consent') { CONSENT = { required: true, consentAt: 5 }; return CONSENT }
    if (path === '/api/me/health-consent/withdraw') { CONSENT = { required: true, consentAt: null }; return CONSENT }
    if (path === '/api/data') return { ok: true }
    throw new Error('unexpected ' + path)
  },
}))
const { useStore } = await import('./store/useStore.js')
const { useUI } = await import('./store/useUI.js')
const { measureSheet, startFlow } = await import('./sheets.jsx')

const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  CONSENT = { required: true, consentAt: null }
  useUI.setState({ sheets: [], toasts: [] })
  useStore.setState(s => ({ user: { id: 'c1', name: 'Salma', coachName: 'Yasmine' }, healthConsent: null, S: { ...s.S, active: null, routines: [] } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('health data and the coach', () => {
  it('asks a coach’s client before the first measurement, then opens it', async () => {
    measureSheet()
    await settle()
    const host = mountTopSheet()
    expect(host.textContent).toContain('Yasmine sees them to coach you')
    expect(host.textContent).toContain('also sees when you are training')
    act(() => { button(host, 'Agree and continue').click() })
    await settle()
    expect(host.textContent).toContain('Tick the box to agree')
    expect(calls.some(([p, m]) => p === '/api/me/health-consent' && m === 'POST')).toBe(false)
    act(() => { host.querySelector('[role="checkbox"]').click() })
    act(() => { button(host, 'Agree and continue').click() })
    await settle()
    expect(calls.find(([p, m]) => p === '/api/me/health-consent' && m === 'POST')[2]).toEqual({ agree: true })
    // The consent sheet closed and the measurement sheet opened in its place.
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(mountTopSheet().textContent).not.toContain('Agree and continue')
  })

  it('opens straight away once the client has agreed, and for someone with no coach', async () => {
    CONSENT = { required: true, consentAt: 5 }
    measureSheet()
    await settle()
    expect(mountTopSheet().textContent).not.toContain('Agree and continue')
    useUI.setState({ sheets: [] })
    useStore.setState({ healthConsent: null })
    CONSENT = { required: false, consentAt: null }
    measureSheet()
    await settle()
    expect(mountTopSheet().textContent).not.toContain('Agree and continue')
  })

  it('starts a workout without the weigh-in rather than asking for consent', async () => {
    startFlow([])
    await settle()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.active).toBeTruthy()
    expect(useStore.getState().S.active.bw).toBe(null)
  })

  it('deletes the health data on this device when consent is withdrawn', async () => {
    useStore.setState(s => ({ healthConsent: { required: true, consentAt: 5 },
      S: { ...s.S, bodyweight: [{ d: '2026-10-30', w: 70 }], checkins: [{ d: '2026-10-30' }], measurements: [{ d: '2026-10-30', site: 'waist', v: 80 }], meals: [{ id: 'm' }], mealDays: { x: 1 } } }))
    await act(async () => { await useStore.getState().withdrawHealthConsent() })
    const S = useStore.getState().S
    expect([S.bodyweight, S.checkins, S.measurements, S.meals, S.mealDays]).toEqual([[], [], [], [], {}])
    expect(useStore.getState().healthConsent).toEqual({ required: true, consentAt: null })
    expect(calls.some(([p]) => p === '/api/me/health-consent/withdraw')).toBe(true)
  })
})
