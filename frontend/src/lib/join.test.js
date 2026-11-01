// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { intakeError, joinHandleFromPath, savedRequest, saveRequest, forgetRequest } from './join.js'

const ok = { goal: 'strength', level: 'beginner', days: 3, injuries: '', equipment: [], phone: '', consent: true }

describe('the intake check (the server makes the same: app/Coaching/Intake.php)', () => {
  it('lets a complete intake through', () => {
    expect(intakeError(ok)).toBe(null)
  })
  it('asks for the basics first', () => {
    expect(intakeError({ ...ok, goal: 'fly' })).toBe('basics')
    expect(intakeError({ ...ok, level: undefined })).toBe('basics')
    expect(intakeError({ ...ok, days: 0 })).toBe('basics')
    expect(intakeError({ ...ok, days: 8 })).toBe('basics')
    expect(intakeError({ ...ok, days: '3' })).toBe('basics')
    expect(intakeError(null)).toBe('basics')
  })
  it('keeps injuries short, and asks for consent', () => {
    expect(intakeError({ ...ok, injuries: 'a'.repeat(501) })).toBe('injuries')
    expect(intakeError({ ...ok, consent: false })).toBe('consent')
  })
})

describe('join paths', () => {
  it('reads the handle, and gives up on anything else', () => {
    expect(joinHandleFromPath('/join/Sara.Fit')).toBe('sara.fit')
    expect(joinHandleFromPath('/join/')).toBe(null)
    expect(joinHandleFromPath('/c/sara.fit')).toBe(null)
    expect(joinHandleFromPath('/join/50%')).toBe(null)
  })
})

describe('the request this browser keeps', () => {
  beforeEach(() => localStorage.clear())
  it('keeps one per coach, and forgets it', () => {
    expect(savedRequest('sara.fit')).toBe(null)
    saveRequest('sara.fit', { id: 'r1', token: 't1' })
    saveRequest('other', { id: 'r2', token: 't2' })
    expect(savedRequest('sara.fit')).toEqual({ id: 'r1', token: 't1' })
    forgetRequest('sara.fit')
    expect(savedRequest('sara.fit')).toBe(null)
    expect(savedRequest('other')).toEqual({ id: 'r2', token: 't2' })
  })
  it('ignores what it did not write', () => {
    localStorage.setItem('join:sara.fit', '{"id":1}')
    expect(savedRequest('sara.fit')).toBe(null)
    localStorage.setItem('join:sara.fit', 'not json')
    expect(savedRequest('sara.fit')).toBe(null)
  })
})

describe('privacyUrl', () => {
  it('opens the privacy section of the legal page in the language of the form', async () => {
    const { privacyUrl } = await import('./join.js')
    expect(privacyUrl('fr')).toBe('https://fitpal.ma/mentions-legales#donnees')
    expect(privacyUrl('es')).toBe('https://fitpal.ma/es/legal#datos')
    expect(privacyUrl('en')).toBe('https://fitpal.ma/en/legal#data')
    // No German page: the English one.
    expect(privacyUrl('de')).toBe('https://fitpal.ma/en/legal#data')
  })
})
