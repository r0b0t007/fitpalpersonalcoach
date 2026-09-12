// @vitest-environment happy-dom
//
// /api/config is what a client knows about the instance before anyone signs in: whether signup
// needs an invite, whether guests are allowed, whether access can be requested.
//
// loadConfig() caches it for a boot; refreshConfig() always asks. The distinction is the point of
// the pair — the sign-in screen decides whether to render the invite-code field from this, and an
// operator who flips INVITE_ONLY while somebody has the app open should not need them to relaunch
// it.
//
// These cases were written against `config.coach`, the AI Coach's flag. That feature is gone and
// the server no longer sends the key, so the assertions held only because refreshConfig stores
// whatever it is handed — they passed against a field nothing produces. Retargeted at the flags
// that still exist.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))

import { api } from '../lib/api.js'
import { useStore } from './useStore.js'

beforeEach(() => { api.mockReset(); useStore.setState({ config: null }) })
afterEach(() => { useStore.setState({ config: null }) })

describe('server config', () => {
  it('loadConfig fetches once and then answers from the cache', async () => {
    api.mockResolvedValue({ invite_only: true, allow_guest: false, request_access: false })
    expect(await useStore.getState().loadConfig())
      .toEqual({ invite_only: true, allow_guest: false, request_access: false })
    expect(await useStore.getState().loadConfig()).toMatchObject({ invite_only: true })
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/config')
  })

  it('refreshConfig always asks, so a gate flipped after boot is seen', async () => {
    api.mockResolvedValueOnce({ invite_only: false, allow_guest: true, request_access: false })
    await useStore.getState().loadConfig()
    expect(useStore.getState().config.invite_only).toBe(false)

    // The operator turns invite-only on while the app is open. The register sheet reads this to
    // decide whether to show the code field at all, so a stale answer is the difference between
    // a working signup and a refused one.
    api.mockResolvedValueOnce({ invite_only: true, allow_guest: true, request_access: false })
    await useStore.getState().refreshConfig()
    expect(useStore.getState().config.invite_only).toBe(true)
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('an unreachable server leaves the cached config alone', async () => {
    // guestAllowed() needs a positive allow_guest:false to end a guest session, so an offline
    // refresh must not look like one — see lib/guest.js.
    useStore.setState({ config: { invite_only: false, allow_guest: true } })
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await useStore.getState().refreshConfig()).toBeNull()
    expect(useStore.getState().config.allow_guest).toBe(true)
  })

  it('carries no coach key — the AI Coach flag the server used to send', async () => {
    api.mockResolvedValue({ invite_only: false, allow_guest: true, request_access: false })
    expect(await useStore.getState().loadConfig()).not.toHaveProperty('coach')
  })
})
