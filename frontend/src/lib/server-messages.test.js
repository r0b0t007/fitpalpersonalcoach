// The real packs, not stand-ins: what is under test is that a refusal as the API actually sends
// it comes out in the user's language. backend/scripts/check-error-strings.mjs keeps the packs
// complete; backend/tests/Unit/SayTest.php covers the server half (say → msg).
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
  it('gives English back as the server wrote it', () => {
    expect(serverText({ error: 'challenge expired — try again' })).toBe('challenge expired — try again')
    expect(serverText({ error: 'that exercise already has 6 videos', msg: { k: 'that exercise already has {0} videos', v: [6] } }))
      .toBe('that exercise already has 6 videos')
  })

  it('translates a plain refusal by its text', () => {
    _setLangState('fr', fr)
    expect(serverText({ error: 'invite code is no longer valid — ask for a new one' }))
      .toBe('ce code d’invitation n’est plus valide — demandez-en un nouveau')
    _setLangState('es', es)
    expect(serverText({ error: 'not signed in' })).toBe('no has iniciado sesión')
  })

  it('translates a refusal with values from the key and values sent beside it', () => {
    _setLangState('fr', fr)
    expect(serverText({ error: 'that exercise already has 6 videos', msg: { k: 'that exercise already has {0} videos', v: [6] } }))
      .toBe('cet exercice a déjà 6 vidéos')
    // The two photo caps share most of their wording; the key, not the text, decides which it is.
    expect(serverText({ error: 'that is 500 MB of photos already stored', msg: { k: 'that is {0} MB of photos already stored', v: ['500'] } }))
      .toBe('500 Mo de photos sont déjà enregistrés, c’est le maximum')
  })

  it('leaves a value someone typed alone, even one that looks like a placeholder', () => {
    _setLangState('fr', fr)
    expect(serverText({ error: 'Marie {1} already has 3 programs waiting', msg: { k: '{0} already has {1} programs waiting', v: ['Marie {1}', 3] } }))
      .toBe('Marie {1} a déjà 3 programmes en attente')
  })

  it('falls back to the text when msg is missing or malformed', () => {
    _setLangState('fr', fr)
    expect(serverText({ error: 'something new from a newer server' })).toBe('something new from a newer server')
    expect(serverText({ error: 'not signed in', msg: 'nonsense' })).toBe('vous n’êtes pas connecté')
    expect(serverText({})).toBe('')
  })
})
