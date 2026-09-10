// The role split is decided in one place (App.jsx) from these three functions, so a wrong
// answer here puts a coach on the trainee's Home or a client on the coach dashboard — and
// nothing throws either way. Locked route by route.
import { describe, it, expect, beforeEach } from 'vitest'
import { isCoach, shellFor, homeFor, getShellPref, setShellPref } from './role.js'

const coach = { id: 'c', name: 'Ahmed', coach: true }
const admin = { id: 'a', name: 'Owner', admin: true, coach: true }   // publicUser marks admins as coaches
const client = { id: 'm', name: 'Sara', coachName: 'Ahmed' }

describe('who is a coach', () => {
  it('is whoever the server flagged, admins included', () => {
    expect(isCoach(coach)).toBe(true)
    expect(isCoach(admin)).toBe(true)
  })
  it('is not a client, a guest, or nobody', () => {
    expect(isCoach(client)).toBe(false)
    expect(isCoach(null)).toBe(false)
    expect(isCoach(undefined)).toBe(false)
  })
})

describe('which shell and which home', () => {
  it('a coach gets the coach shell and lands on /today', () => {
    expect(shellFor(coach)).toBe('coach')
    expect(homeFor(coach)).toBe('/today')
  })
  it('a client gets the training app whatever the preference says', () => {
    expect(shellFor(client)).toBe('client')
    expect(shellFor(client, 'coach')).toBe('client')
    expect(homeFor(client, 'coach')).toBe('/home')
  })
  it('a coach who chose "Train myself" gets the training app until they come back', () => {
    expect(shellFor(coach, 'client')).toBe('client')
    expect(homeFor(coach, 'client')).toBe('/home')
    expect(shellFor(coach, 'coach')).toBe('coach')
  })
  it('a guest is a client', () => {
    expect(shellFor(null)).toBe('client')
    expect(homeFor(null)).toBe('/home')
  })
})

describe('the preference', () => {
  beforeEach(() => setShellPref('coach'))

  it('defaults to the coach shell', () => {
    expect(getShellPref()).toBe('coach')
  })
  it('remembers "client" and anything else means the default', () => {
    setShellPref('client')
    expect(getShellPref()).toBe('client')
    setShellPref('nonsense')
    expect(getShellPref()).toBe('coach')
  })
  it('works without localStorage at all (private mode, node) — in memory only', () => {
    // This suite runs under node with no localStorage; a throw here would take App.jsx down.
    expect(() => setShellPref('client')).not.toThrow()
    expect(getShellPref()).toBe('client')
  })
})
