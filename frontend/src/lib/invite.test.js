// @vitest-environment happy-dom
//
// The link IS the invite. All a client is ever given is a URL, so anything wrong with it is
// unrecoverable at their end: there is no code to retype and nobody to ask but the coach.
import { describe, it, expect, beforeEach } from 'vitest'
import { inviteLink } from './invite.js'

const at = href => { history.replaceState(null, '', href); return inviteLink('ABC123') }

beforeEach(() => { history.replaceState(null, '', '/') })

describe('inviteLink', () => {
  it('points at the app the coach is actually using', () => {
    // Built from location rather than a configured origin: coach.fitpal.ma, a self-hosted
    // instance and localhost all have to work with nobody setting a variable.
    expect(at('/')).toBe('http://localhost:3000/?invite=ABC123')
  })

  it('keeps the path, for an app served from a subdirectory', () => {
    expect(at('/coach/')).toBe('http://localhost:3000/coach/?invite=ABC123')
  })

  it('drops the hash route the coach happened to be on', () => {
    // A coach taps Share from #/clients. Carrying that along sends a brand-new visitor — with no
    // account — to a coach screen that bounces them somewhere else before the invite is read.
    expect(at('/#/clients')).toBe('http://localhost:3000/?invite=ABC123')
  })

  it('does not stack a second code onto a link that already had one', () => {
    // The coach opened the app from someone else's invite link at some point. Two `invite`
    // parameters and the server reads the first one.
    const link = at('/?invite=OLDCODE0000')
    expect(link).toBe('http://localhost:3000/?invite=ABC123')
    expect(new URL(link).searchParams.getAll('invite')).toEqual(['ABC123'])
  })

  it('normalises the code the same way the server will read it', () => {
    history.replaceState(null, '', '/')
    expect(inviteLink('  abc123  ')).toBe('http://localhost:3000/?invite=ABC123')
  })

  it('escapes rather than pasting a code straight into a query string', () => {
    history.replaceState(null, '', '/')
    expect(inviteLink('a&b=c')).toBe('http://localhost:3000/?invite=A%26B%3DC')
  })
})
