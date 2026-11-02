// @vitest-environment happy-dom
//
// The WhatsApp buttons (CHW-341): the client writes to their coach from the Coach screen, the
// coach to their client from the client's page — each with the other's number and a first line
// typed, and no button at all without a number.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let PHONE = ''
vi.mock('../lib/api.js', () => ({
  api: async path => {
    if (path.startsWith('/api/coach/member?')) return {
      user: { id: 'u1', name: 'Salma', created: '2026-03-01' }, phone: PHONE,
      workouts: [], bodyweight: [], routines: [], checkins: [], photos: [], notes: [], week: {},
    }
    if (path === '/api/coach/members') return { members: [] }
    return {}
  },
  fetchMyPhotos: async () => [],
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true, setRemoteAuth: () => {},
}))
vi.mock('../lib/programs.js', () => ({ fetchPrograms: async () => ({ programs: [] }) }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { default: MyCoach } = await import('./MyCoach.jsx')
const { default: ClientDetail } = await import('./coach/ClientDetail.jsx')
const { useStore, DEF } = await import('../store/useStore.js')

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  PHONE = ''
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const mount = async (path, route, el) => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>))
  await act(async () => {})
}
const wa = () => container.querySelector('a[href^="https://wa.me/"]')
const typed = a => decodeURIComponent(a.href.split('text=')[1])

describe('the client’s WhatsApp button', () => {
  const asClient = coachWhatsapp => useStore.setState({
    S: structuredClone(DEF), assignments: [], user: { id: 'm1', name: 'Salma', coachName: 'Yasmine', coachWhatsapp },
  })

  it('writes to their coach on the number from the coach’s page', async () => {
    asClient('212612345678')
    await mount('/coach', '/coach', <MyCoach />)
    expect(wa().textContent).toBe('Message Yasmine on WhatsApp')
    expect(wa().href.startsWith('https://wa.me/212612345678?text=')).toBe(true)
    expect(typed(wa())).toBe('Hello Yasmine, it’s Salma (via FitPal)')
  })

  it('is not there when the coach gave no number', async () => {
    asClient('')
    await mount('/coach', '/coach', <MyCoach />)
    expect(container.textContent).toContain('Yasmine')
    expect(wa()).toBe(null)
  })
})

describe('the coach’s WhatsApp button', () => {
  beforeEach(() => useStore.setState({ user: { id: 'c1', name: 'Yasmine', coach: true } }))

  it('writes to the client on the number they asked with', async () => {
    PHONE = '33612345678'
    await mount('/clients/u1', '/clients/:id', <ClientDetail />)
    expect(wa().textContent).toBe('Message Salma on WhatsApp')
    expect(wa().href.startsWith('https://wa.me/33612345678?text=')).toBe(true)
    expect(typed(wa())).toBe('Hello Salma, it’s Yasmine, your coach')
  })

  it('is not there for a client who gave none', async () => {
    await mount('/clients/u1', '/clients/:id', <ClientDetail />)
    expect(container.textContent).toContain('Salma')
    expect(wa()).toBe(null)
  })
})
