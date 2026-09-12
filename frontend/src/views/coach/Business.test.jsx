// @vitest-environment happy-dom
//
// What this screen says about WHOSE account you are looking at.
//
// Two of these were wrong, and both are invisible on the single-admin, single-coach instance the
// app is usually developed against — which is exactly why they need pinning. `admin` comes from
// ADMIN_UIDS, which is a LIST, so it means "runs the instance", not "is you"; and `coachId` is
// some coach's id, not necessarily the viewer's. Read as "you" and "your client", the screen told
// an admin that somebody else's account was theirs and pointed them at a Clients list that person
// is not on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let USERS = []
let DETAIL = {}
vi.mock('../../lib/api.js', () => ({
  api: async path => {
    if (path.startsWith('/api/admin/users')) return { users: USERS }
    if (path.startsWith('/api/admin/user?')) {
      const id = decodeURIComponent(path.split('id=')[1])
      return { user: USERS.find(u => u.id === id), workouts: [], bodyweight: [], routines: [], unit: 'kg' }
    }
    throw new Error('unexpected ' + path)
  },
}))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const { BusinessAccounts, AccountSheet } = await import('./Business.jsx')
const { useStore } = await import('../../store/useStore.js')

const ME = { id: 'me', name: 'Ahmed', admin: true, coach: true }
const OTHER_ADMIN = { id: 'other', name: 'Co-owner', admin: true, coach: true }
const MY_CLIENT = { id: 'c1', name: 'Sara', coachId: 'me' }
const THEIR_CLIENT = { id: 'c2', name: 'Nadia', coachId: 'other' }

let container, root
const text = () => container.textContent

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  USERS = [ME, OTHER_ADMIN, MY_CLIENT, THEIR_CLIENT]
  useStore.setState({ user: ME })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const render = async el => { await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) }) }
const rowFor = name => [...container.querySelectorAll('.item')].find(b => b.textContent.includes(name))

describe('the accounts list', () => {
  it('marks only the viewer as "you", and another admin as "admin"', async () => {
    await render(<BusinessAccounts />)
    expect(rowFor('Ahmed').textContent).toContain('you')
    expect(rowFor('Co-owner').textContent).toContain('admin')
    expect(rowFor('Co-owner').textContent).not.toContain('you')
  })

  it('lists everyone with a profile, clients of other coaches included', async () => {
    await render(<BusinessAccounts />)
    for (const n of ['Ahmed', 'Co-owner', 'Sara', 'Nadia']) expect(rowFor(n), n).toBeTruthy()
  })
})

describe('one account', () => {
  it('points at Clients only for the viewer’s OWN client', async () => {
    await render(<AccountSheet id="c1" onChanged={() => {}} close={() => {}} />)
    expect(text()).toContain('One of your clients')
  })

  it('says nothing about Clients for a client of another coach', async () => {
    // They would not be on the viewer's Clients list, so sending them there is a dead end.
    await render(<AccountSheet id="c2" onChanged={() => {}} close={() => {}} />)
    expect(text()).not.toContain('One of your clients')
  })

  it('does not claim another admin’s account is the viewer’s own', async () => {
    await render(<AccountSheet id="other" onChanged={() => {}} close={() => {}} />)
    expect(text()).not.toContain('This is you')
    expect(text()).toContain('cannot be disabled from here')
  })

  it('still explains why the viewer cannot disable themselves', async () => {
    await render(<AccountSheet id="me" onChanged={() => {}} close={() => {}} />)
    expect(text()).toContain('This is you')
  })

  it('offers Disable only for an account the server would accept it for', async () => {
    // The server refuses to disable any admin, so a button for one is a 403 waiting to happen.
    await render(<AccountSheet id="c1" onChanged={() => {}} close={() => {}} />)
    expect(text()).toContain('Disable account')

    act(() => root.unmount()); container.remove()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    await render(<AccountSheet id="other" onChanged={() => {}} close={() => {}} />)
    expect(text()).not.toContain('Disable account')
  })
})
