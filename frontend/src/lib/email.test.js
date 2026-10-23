import { describe, it, expect } from 'vitest'
import { isEmail } from './email.js'

describe('isEmail', () => {
  it('takes ordinary addresses — including ones with an "s" in them', () => {
    // The regression: a copy with \s turned into s refused every one of these.
    for (const a of ['sara@gmail.com', 'coach@fitness.ma', 'x@outlook.es', ' amina@example.test '])
      expect(isEmail(a), a).toBe(true)
  })

  it('refuses what is plainly not an address', () => {
    for (const a of ['', 'not-an-address', 'a@b', 'a b@c.d', '@example.com', 'a@.', null, undefined])
      expect(isEmail(a), String(a)).toBe(false)
  })
})
