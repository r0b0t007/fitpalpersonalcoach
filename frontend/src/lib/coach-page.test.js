import { describe, it, expect } from 'vitest'
import { normaliseHandle, validHandle, pageUrl, coachHandleFromPath, BIO_MAX } from './coach-page.js'

describe('coach page handles (the server checks the same rules: app/Coaching/Handle.php)', () => {
  it('reads a handle as Instagram writes it', () => {
    expect(normaliseHandle(' @Sara.Fit ')).toBe('sara.fit')
    expect(normaliseHandle(null)).toBe('')
  })
  it('keeps to 3–30 letters, digits, dots and underscores, no dot at either end or doubled', () => {
    for (const ok of ['sara.fit', 'sa_ra', 'abc', 'a'.repeat(30)]) expect(validHandle(ok)).toBe(true)
    for (const bad of ['ab', 'a'.repeat(31), 'sara-fit', '.sara', 'sara.', 'sa..ra', 'Sara']) expect(validHandle(bad)).toBe(false)
  })
  it('builds the link a coach puts in their bio', () => {
    expect(pageUrl('sara.fit', 'https://coach.fitpal.ma')).toBe('https://coach.fitpal.ma/c/sara.fit')
    expect(BIO_MAX).toBe(160)
  })
  it('recognises the public page path, and nothing else', () => {
    expect(coachHandleFromPath('/c/sara.fit')).toBe('sara.fit')
    expect(coachHandleFromPath('/c/Sara.Fit')).toBe('sara.fit')
    expect(coachHandleFromPath('/clients')).toBe(null)
    expect(coachHandleFromPath('/c/')).toBe(null)
    expect(coachHandleFromPath('/c/a/b')).toBe(null)
  })
})
