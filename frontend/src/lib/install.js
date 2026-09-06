// Browser PWA install offer.
//
// Chrome (and other Chromium browsers) fire `beforeinstallprompt` once the manifest + service
// worker make the app installable; we capture that event so a UI element can trigger the native
// install dialog on demand instead of waiting for the browser's own address-bar icon. Safari and
// Firefox never fire it — there is no programmatic install there, so the UI falls back to showing
// the manual "Add to Home Screen" steps (already translated, see Settings.jsx's Tip section).
//
// A device that dismissed the offer isn't asked again for SNOOZE_MS. A device that installed
// isn't asked again at all — permanently, via isInstalled() below, not just isStandalone(): the
// tab the install was triggered from keeps running as a normal browser tab (the freshly
// installed app opens in its own window), so isStandalone() alone would stay false there
// forever and the UI would fall back to stale "here's how to install" copy right after a
// successful install. Like DEMO_SEEDED in demo.js, both flags are raw localStorage keys rather
// than app state — a per-device fact, not something to sync to a profile or clear on sign-out
// (see clearLocalSession in store/useStore.js).
import { useSyncExternalStore } from 'react'
import { MOBILE } from './mobile.js'

export const INSTALL_SNOOZED = 'gym_install_snoozed_v1'
export const SNOOZE_MS = 7 * 24 * 3600 * 1000
export const INSTALLED = 'gym_install_installed_v1'

// True once installed (via the browser's own UI or our prompt) — on iOS/iPadOS Safari's
// `navigator.standalone`, everywhere else the `display-mode` media query the manifest requests.
export function isStandalone() {
  try {
    return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone === true
  } catch (e) { return false }
}

export function installSnoozed() {
  try {
    const ts = Number(localStorage.getItem(INSTALL_SNOOZED))
    return Number.isFinite(ts) && ts > 0 && Date.now() - ts < SNOOZE_MS
  } catch (e) { return false }
}

// Permanent, unlike the snooze — there's no "uninstalled" event to clear it on, which mirrors
// how little any of this can know about a real uninstall; the offer just never resurfaces on
// this device once it has installed here.
export function isInstalled() {
  try { return localStorage.getItem(INSTALLED) === '1' } catch (e) { return false }
}

let deferred = null        // the captured beforeinstallprompt event, or null
let version = 0            // bumped on every state change; drives the React subscription
let initialized = false
const subs = new Set()
const notify = () => { version++; subs.forEach(fn => fn()) }

export function snoozeInstall() {
  try { localStorage.setItem(INSTALL_SNOOZED, String(Date.now())) } catch (e) { /* ignore */ }
  notify()
}

export function markInstalled() {
  try { localStorage.setItem(INSTALLED, '1') } catch (e) { /* ignore */ }
  notify()
}

// !MOBILE: the Capacitor build has no browser chrome to install from at all.
export const shouldOfferInstall = () => !MOBILE && !isStandalone() && !isInstalled() && !installSnoozed()

export const canPrompt = () => !!deferred

// Fires the previously captured native install dialog. 'unavailable' covers every case where
// there is nothing to fire — iOS/Firefox (no API), or the event was already spent this session.
// Marking installed on 'accepted' here (rather than waiting on the 'appinstalled' listener below)
// is what makes every consumer stop offering the install immediately, in the same tab, without a
// visible flash back to "here's how to install manually" while appinstalled is still in flight.
export async function promptInstall() {
  if (!deferred) return 'unavailable'
  const e = deferred
  deferred = null
  notify()
  e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') markInstalled()
  return outcome
}

// Captures beforeinstallprompt as early as possible — call once from main.jsx, before React
// mounts, since Chrome can fire the event before any component exists to subscribe to it.
// Module-scope + the `initialized` guard means StrictMode's double-invoke can't attach it twice.
export function initInstall() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()   // suppress the browser's own mini-infobar; our UI offers it instead
    deferred = e
    notify()
  })
  // Backstop for installing via the browser's own UI (address-bar icon) rather than our prompt —
  // promptInstall() already marks installed for its own path.
  window.addEventListener('appinstalled', () => { deferred = null; markInstalled() })
}

// Re-renders the subscribing component when the deferred prompt arrives (it often lands a second
// or more after load — a mount-only check would miss it), is consumed, or install/snooze state changes.
export function useInstallPrompt() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
