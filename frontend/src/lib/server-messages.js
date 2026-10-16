// What the API refuses with, in the user's language (CHW-199).
//
// The server speaks English, and English is the translation key, so a plain refusal ("challenge
// expired — try again") is just t(error). One with a value in it ("that exercise already has 6
// videos") is not a key as sent; the server sends the template and the values beside it as
// `msg: { k, v }` (say in api/domain.mjs), and those are what get translated. A server too old
// to send msg still gets its English through, untouched.
import { t } from './i18n-core.js'

export function serverText(data) {
  const msg = data && data.msg
  if (msg && typeof msg.k === 'string' && Array.isArray(msg.v)) return t(msg.k, ...msg.v)
  return t(String((data && data.error) ?? ''))
}
