import { describe, it, expect } from 'vitest'
import { privacyUrl, termsUrl } from './terms.js'

describe('termsUrl', () => {
  it('opens the coach terms in the language of the app', () => {
    expect(termsUrl('fr')).toBe('https://fitpal.ma/conditions')
    expect(termsUrl('es')).toBe('https://fitpal.ma/es/terms')
    expect(termsUrl('en')).toBe('https://fitpal.ma/en/terms')
    // No German text: the English one.
    expect(termsUrl('de')).toBe('https://fitpal.ma/en/terms')
  })
})

describe('privacyUrl', () => {
  it('opens the privacy section of the legal page in the language of the app', () => {
    expect(privacyUrl('fr')).toBe('https://fitpal.ma/mentions-legales#donnees')
    expect(privacyUrl('es')).toBe('https://fitpal.ma/es/legal#datos')
    expect(privacyUrl('en')).toBe('https://fitpal.ma/en/legal#data')
    // No German page: the English one.
    expect(privacyUrl('de')).toBe('https://fitpal.ma/en/legal#data')
  })
})
