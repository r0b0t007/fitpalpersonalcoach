// Rendering for the admin activity log (GET /api/admin/audit).
//
// The server stores reason codes, not sentences — `{ ev: 'auth.login.fail', msg: 'unknown-credential' }`
// rather than "someone tried a passkey we don't know". Turning those into English
// belongs here and not in the screen: it is the only part of the feature that can be wrong in a
// way a person sees, and as a plain module it is testable without mounting anything.
//
// Labels and reasons are functions, so they are read in the viewer's language at render while the
// stored event names stay English (data/audit.log is a server artifact, not UI). Literal t() calls,
// so check-source-strings sees every key; backend/scripts/check-audit-labels.mjs reads only the keys.
import { dateLocale, t } from './i18n-core.js'

// The first segment of an event name is also the filter chip it belongs to.
export const auditCat = ev => String(ev || '').split('.')[0]

const LABELS = {
  'auth.login.ok': () => t('Signed in'),
  'auth.login.fail': () => t('Sign-in failed'),
  'auth.register.ok': () => t('Created a profile'),
  'auth.register.fail': () => t('Profile creation failed'),
  'auth.register.denied': () => t('Signup refused'),
  'auth.logout': () => t('Signed out'),
  'auth.logout.all': () => t('Signed out everywhere'),
  'login.link': () => t('Signed in with an email link'),
  'login.link.throttled': () => t('Too many sign-in links asked for'),
  'account.email': () => t('Changed the sign-in email'),
  'auth.passkey.add': () => t('Added a passkey'),
  'admin.user.disable': () => t('Disabled an account'),
  'admin.user.enable': () => t('Re-enabled an account'),
  'admin.user.coach': () => t('Made an account a coach'),
  'admin.user.uncoach': () => t('Took the coach role away'),
  'admin.user.assign': () => t('Changed a client’s coach'),
  'admin.user.unassign': () => t('Took a client off their coach’s list'),
  'admin.licence.grant': () => t('Granted a plan'),
  'admin.licence.revoke': () => t('Revoked a granted plan'),
  'admin.media.delete': () => t('Deleted an exercise demo'),
  'admin.panel.login': () => t('Signed in to the admin panel'),
  'admin.panel.login.fail': () => t('Failed sign-in to the admin panel'),
  'billing.event': () => t('A payment update from Creem'),
  'billing.stale': () => t('An out-of-date payment update from Creem (ignored)'),
  'billing.ignored': () => t('A Creem event with nothing to apply'),
  'billing.orphan': () => t('A Creem event for no known account'),
  'billing.conflict': () => t('A Creem payment for a coach who has a granted plan'),
  'billing.unsold': () => t('A Creem payment for a product not on sale here'),
  'billing.refund': () => t('A refund in Creem'),
  'billing.dispute': () => t('A payment dispute in Creem'),
  'admin.invite.create': () => t('Created an invite code'),
  'admin.invite.revoke': () => t('Revoked an invite code'),
  'admin.audit.clear': () => t('Cleared the activity log'),
  'admin.denied': () => t('Blocked from the admin dashboard'),
  // Pairing the phone app. These three were emitted unlabelled from the day they were added —
  // the dashboard printed "auth.pair.ok" at whoever read it — because the only guard was a
  // hand-typed copy of the event names in a test. A script reading both sides found them; it is
  // backend/scripts/check-audit-labels.mjs now.
  'auth.pair.create': () => t('Started pairing a phone'),
  'auth.pair.ok': () => t('Paired a phone'),
  'auth.pair.fail': () => t('Phone pairing failed'),
  // A coach taking a client on, rather than an admin assigning one.
  'coach.program.save': () => t('Saved a program'),
  'coach.page.save': () => t('Saved their public page'),
  'join.request': () => t('Asked to join a coach'),
  'join.request.throttled': () => t('Too many join requests asked for'),
  'join.verify': () => t('Confirmed a join request by email'),
  'coach.program.delete': () => t('Deleted a program'),
  'coach.invite.create': () => t('Created a client code'),
  'coach.invite.revoke': () => t('Revoked a client code'),
  // Both ends of a coaching relationship that is not a signup. Redeeming is the client's own act,
  // from an account they already had; releasing is the coach's.
  'invite.redeem': () => t('Joined a coach with a code'),
  'coach.member.release': () => t('Released a client')
}
// An unknown event is shown raw rather than dropped or rendered as "undefined": a dashboard
// that is one version behind the server should still say *something* truthful.
export const auditLabel = ev => (LABELS[ev] ? LABELS[ev]() : String(ev || t('Unknown event')))

const REASONS = {
  'challenge-expired': () => t('the sign-in took too long and expired'),
  'unknown-credential': () => t('unknown passkey'),
  'verify-error': () => t('the passkey could not be verified'),
  'not-verified': () => t('the passkey was rejected'),
  'user-missing': () => t('the passkey points at a profile that no longer exists'),
  'account-disabled': () => t('the account is disabled'),
  'credential-exists': () => t('that passkey already belongs to a profile'),
  'invite-invalid': () => t('the invite code was used or revoked in the meantime'),
  'invite-rejected': () => t('wrong or already-used invite code')
}
export const auditReason = msg => (REASONS[msg] ? REASONS[msg]() : (msg ? String(msg) : ''))

// → { title, sub }. `sub` is the house "a · b · c" metadata line used by every list row.
export function auditLine(e) {
  if (!e) return { title: '', sub: '' }
  const parts = []
  if (e.name) parts.push(e.name)
  else if (e.uid) parts.push(e.uid)
  else if (!e.ok) parts.push(t('unknown caller'))
  if (e.tname) parts.push('→ ' + e.tname)
  // The reason codes and the invite codes share the msg field; only failures read as a reason.
  if (e.msg) parts.push(e.ok ? e.msg : auditReason(e.msg))
  if (e.ip) parts.push(e.ip)
  return { title: auditLabel(e.ev), sub: parts.join(' · ') }
}

// The activity log is the one place in the app that needs a clock, and fmtDate() renders none —
// it is used by every other view and is not worth changing for this.
export function fmtWhen(ts, now = Date.now()) {
  if (!ts) return ''
  const d = new Date(ts)
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  const n = new Date(now)
  const sameDay = d.toDateString() === n.toDateString()
  if (sameDay) return t('today {0}', time)
  if (now - ts < 6 * 86400000 && ts <= now) return d.toLocaleDateString(dateLocale(), { weekday: 'short' }) + ' ' + time
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) + ' ' + time
}
