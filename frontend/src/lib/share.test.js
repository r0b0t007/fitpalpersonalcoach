// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLink } from './share.js'

afterEach(() => { vi.unstubAllGlobals(); delete navigator.share })

describe('shareLink', () => {
  it('shares when the phone can', async () => {
    navigator.share = vi.fn(async () => {})
    expect(await shareLink({ url: 'https://x', title: 'T' })).toBe('shared')
    expect(navigator.share).toHaveBeenCalledWith({ title: 'T', text: undefined, url: 'https://x' })
  })
  it('treats closing the share sheet as a no', async () => {
    navigator.share = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) })
    expect(await shareLink({ url: 'https://x' })).toBe('cancelled')
  })
  it('copies when it cannot share, and says so when neither works', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } })
    expect(await shareLink({ url: 'https://x' })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://x')
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText: () => Promise.reject(new Error('no')) } })
    expect(await shareLink({ url: 'https://x' })).toBe('failed')
  })
})
