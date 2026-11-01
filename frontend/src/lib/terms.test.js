import { describe, it, expect } from 'vitest'
import { termsUrl } from './terms.js'

describe('termsUrl', () => {
  it('opens the coach terms in the language of the app', () => {
    expect(termsUrl('fr')).toBe('https://fitpal.ma/conditions')
    expect(termsUrl('es')).toBe('https://fitpal.ma/es/terms')
    expect(termsUrl('en')).toBe('https://fitpal.ma/en/terms')
    // No German text: the English one.
    expect(termsUrl('de')).toBe('https://fitpal.ma/en/terms')
  })
})
