// @vitest-environment happy-dom
//
// Release is how a coach at their plan's cap frees a seat (CHW-320): the at-cap invite card sends
// them here. It must call the coach's own release route — never the operator's disable — and only
// once the coach has confirmed.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
vi.mock('../../lib/api.js', () => ({
  api: async (path, opts) => {
    calls.push([path, opts])
    if (path.startsWith('/api/coach/member?')) return {
      user: { id: 'u1', name: 'sara', created: '2026-03-01' },
      workouts: [], bodyweight: [], routines: [], checkins: [], photos: [], week: {},
    }
    if (path === '/api/coach/members') return { members: [] }
    return { ok: true }
  },
}))
vi.mock('../../lib/programs.js', () => ({ fetchPrograms: async () => ({ programs: [] }) }))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))
let confirm = null
vi.mock('../../sheets.jsx', () => ({ confirmSheet: o => { confirm = o } }))

const { default: ClientDetail } = await import('./ClientDetail.jsx')

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  confirm = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const mount = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/clients/u1']}>
    <Routes>
      <Route path="/clients/:id" element={<ClientDetail />} />
      <Route path="/clients" element={<p>roster</p>} />
    </Routes>
  </MemoryRouter>))
  await act(async () => {})
}
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent === label)

describe('releasing a client', () => {
  it('asks first, then calls the coach release route and goes back to the roster', async () => {
    await mount()
    await act(async () => { button('Release client').click() })
    expect(confirm.title).toBe('Release sara?')
    expect(confirm.danger).toBe(true)
    expect(calls.some(([p]) => p.includes('release'))).toBe(false)

    await act(async () => { await confirm.onConfirm() })
    const [, opts] = calls.find(([p]) => p === '/api/coach/member/release')
    expect(JSON.parse(opts.body)).toEqual({ id: 'u1' })
    expect(calls.some(([p]) => p.includes('/admin/'))).toBe(false)
    expect(container.textContent).toBe('roster')
  })
})
