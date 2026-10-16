// The real packs, not stand-ins: what is under test is that a message as the API actually sends
// it comes out in the user's language, and api/scripts/check-error-strings.mjs is what keeps the
// packs and SERVER_TEMPLATES complete.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fr from '../locales/fr.js'
import es from '../locales/es.js'

let serverText, _setLangState

beforeEach(async () => {
  vi.resetModules()
  ;({ _setLangState } = await import('./i18n-core.js'))
  ;({ serverText } = await import('./server-messages.js'))
})

describe('serverText', () => {
  it('passes English through untouched', () => {
    expect(serverText('challenge expired — try again')).toBe('challenge expired — try again')
    expect(serverText('that exercise already has 6 videos')).toBe('that exercise already has 6 videos')
  })

  it('translates a plain refusal by its text', () => {
    _setLangState('fr', fr)
    expect(serverText('invite code is no longer valid — ask for a new one'))
      .toBe('ce code d’invitation n’est plus valide — demandez-en un nouveau')
    _setLangState('es', es)
    expect(serverText('not signed in')).toBe('no has iniciado sesión')
  })

  it('finds the template a message with values was built from, and keeps the values', () => {
    _setLangState('fr', fr)
    expect(serverText('that exercise already has 6 videos')).toBe('cet exercice a déjà 6 vidéos')
    // A value with spaces in it, and two of them.
    expect(serverText('Marie Dupont already has 3 programs waiting')).toBe('Marie Dupont a déjà 3 programmes en attente')
    // Regex characters in the template itself: parentheses here, '=' and '.' below.
    expect(serverText('too many routines (max 20)')).toBe('trop de séances (20 au maximum)')
    _setLangState('es', es)
    expect(serverText('image/avif is not a supported image format — use JPEG, PNG, WebP or GIF'))
      .toBe('image/avif no es un formato de imagen compatible — usa JPEG, PNG, WebP o GIF')
    expect(serverText('Unexpected RP ID hash — this server is configured with RP_ID=coach.fitpal.ma and ORIGIN=https://coach.fitpal.ma, and both must match the address you opened. See docs/SELF_HOSTING.md.'))
      .toBe('Unexpected RP ID hash — este servidor está configurado con RP_ID=coach.fitpal.ma y ORIGIN=https://coach.fitpal.ma, y ambos deben coincidir con la dirección que abriste. Consulta docs/SELF_HOSTING.md.')
  })

  it('leaves a message it does not know as the server wrote it', () => {
    _setLangState('fr', fr)
    expect(serverText('something new from a newer server')).toBe('something new from a newer server')
    expect(serverText(undefined)).toBe('')
  })
})
