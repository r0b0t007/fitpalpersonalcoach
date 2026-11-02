import { describe, it, expect } from 'vitest'
import { waDigits, waInput, waLink } from './whatsapp.js'
import parity from './phone-parity.json'

describe('waDigits', () => {
  // The server's reading (backend Phone::digits runs the same cases, tests/Unit/PhoneParityTest.php):
  // with no country to assume, the app reads every number as the server will store it.
  it('reads a number with no country to assume as the server does', () => {
    expect(parity.cases.length).toBeGreaterThan(0)
    for (const c of parity.cases) expect(waDigits(c.raw, 'UTC'), JSON.stringify(c)).toBe(c.want)
  })

  it('never sends a Spanish number it cannot place for the server to keep as +61', () => {
    expect(waDigits('612 34 56 78', 'UTC')).toBe(null)
    expect(waInput('612 34 56 78', 'UTC')).toBe('612 34 56 78')   // left as typed: the server refuses it
    expect(waDigits('612 34 56 78', 'Europe/Madrid')).toBe('34612345678')
  })

  it('takes an international number however it is typed', () => {
    for (const raw of ['+212 6 12 34 56 78', '00212612345678', '+212-612-345-678', '+212 (6) 12.34.56.78'])
      expect(waDigits(raw, 'UTC')).toBe('212612345678')
  })

  it('reads a Moroccan 06 or 07 number typed without +212, on a phone in Morocco', () => {
    expect(waDigits('06 12 34 56 78', 'Africa/Casablanca')).toBe('212612345678')
    expect(waDigits('0712345678', 'Africa/Casablanca')).toBe('212712345678')
    expect(waDigits('0522 12 34 56', 'Africa/Casablanca')).toBe('212522123456')
  })

  it('gives the same 06 the country of the device typing it', () => {
    expect(waDigits('06 12 34 56 78', 'Europe/Paris')).toBe('33612345678')
    expect(waDigits('0470 12 34 56', 'Europe/Brussels')).toBe('32470123456')
    expect(waDigits('612 34 56 78', 'Europe/Madrid')).toBe('34612345678')
    expect(waDigits('612345678', 'Atlantic/Canary')).toBe('34612345678')
  })

  it('does not guess a country it cannot tell', () => {
    expect(waDigits('0612345678', 'UTC')).toBe(null)
    expect(waDigits('0612345678', 'America/New_York')).toBe(null)
  })

  it('refuses what is not a number, and says blank apart', () => {
    expect(waDigits('', 'Africa/Casablanca')).toBe('')
    expect(waDigits('   ', 'Africa/Casablanca')).toBe('')
    expect(waDigits(null, 'Africa/Casablanca')).toBe('')
    for (const raw of ['hello', '+0612345678', '061234', '06123456789', '+212 6 12 34 56 78 90 12 34'])
      expect(waDigits(raw, 'Africa/Casablanca')).toBe(null)
  })
})

describe('waInput', () => {
  it('shows the number with its country once it is one', () => {
    expect(waInput('06 12 34 56 78', 'Africa/Casablanca')).toBe('+212612345678')
    expect(waInput('00 34 612 345 678', 'UTC')).toBe('+34612345678')
  })

  it('leaves the rest as typed, for the server to judge', () => {
    expect(waInput(' 0612345678 ', 'UTC')).toBe('0612345678')
    expect(waInput('', 'UTC')).toBe('')
  })
})

describe('waLink', () => {
  it('opens a chat with the number and the first line typed', () => {
    expect(waLink('212612345678', 'Bonjour Sara, c’est Yasmine de FitPal'))
      .toBe('https://wa.me/212612345678?text=' + encodeURIComponent('Bonjour Sara, c’est Yasmine de FitPal'))
    expect(waLink('212612345678')).toBe('https://wa.me/212612345678')
  })

  it('is nothing without a number', () => {
    expect(waLink('')).toBe(null)
    expect(waLink(null, 'hi')).toBe(null)
  })
})
