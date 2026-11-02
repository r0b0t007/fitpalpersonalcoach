// WhatsApp, where everything that is not a reply on a check-in or a workout happens (CHW-341): a
// wa.me link that opens a chat with the number and a first line already typed, and the number as
// people type it turned into the one wa.me dials — digits, country code first.
//
// The server stores and checks the international form only (backend/app/Support/Phone.php). A
// number typed the way it is said at home — 06 12 34 56 78 — has no country in it, and 06 is a
// mobile in Morocco and in France alike, so the country is the typing device's: its timezone says
// where it is. Unknown there (UTC, a hardened browser) and the number is left as typed, for the
// server to refuse with "include the country code" rather than guess Morocco for someone in Lyon.
import { localTZ } from './format.js'

// The markets served (spec: Francophone + Spain): the code, and the national form a mobile or
// landline takes there. Morocco, France and Belgium dial a leading 0 at home that the
// international form drops; Spain has none, its nine digits start 6–9.
const COUNTRY = {
  'Africa/Casablanca': { cc: '212', national: /^0([5-8]\d{8})$/ },
  'Africa/El_Aaiun': { cc: '212', national: /^0([5-8]\d{8})$/ },
  'Europe/Paris': { cc: '33', national: /^0([1-9]\d{8})$/ },
  'Europe/Brussels': { cc: '32', national: /^0([1-9]\d{7,8})$/ },
  'Europe/Madrid': { cc: '34', national: /^([6-9]\d{8})$/ },
  'Africa/Ceuta': { cc: '34', national: /^([6-9]\d{8})$/ },
  'Atlantic/Canary': { cc: '34', national: /^([6-9]\d{8})$/ },
}

/**
 * The digits wa.me dials, from what someone typed: '' for blank, null for what is not a number
 * (or a national one from a place this cannot tell). Spaces, dashes, dots and brackets are
 * dropped, and a leading + or 00 — as the server does.
 */
export function waDigits(raw, tz = localTZ()) {
  if (raw == null || String(raw).trim() === '') return ''
  const s = String(raw).replace(/[\s\-.()]/g, '')
  if (/^(\+|00)[1-9]\d{7,14}$/.test(s)) return s.replace(/^(\+|00)/, '')
  const m = COUNTRY[tz]?.national.exec(s)
  return m ? COUNTRY[tz].cc + m[1] : null
}

/**
 * What a phone field sends and shows once left: the international form when the number is one,
 * so the person sees the country that was assumed; as typed otherwise, for the server's word on it.
 */
export function waInput(raw, tz = localTZ()) {
  const d = waDigits(raw, tz)
  return d ? '+' + d : String(raw ?? '').trim()
}

/** The chat link for stored digits, with `text` typed in it; null without a number. */
export function waLink(digits, text = '') {
  const d = String(digits ?? '').replace(/\D/g, '')
  if (!d) return null
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '')
}
