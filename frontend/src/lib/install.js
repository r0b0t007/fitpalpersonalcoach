// Browser PWA install offer.
//
// Chrome (and other Chromium browsers) fire `beforeinstallprompt` once the manifest + service
// worker make the app installable; we capture that event so a UI element can trigger the native
// install dialog on demand instead of waiting for the browser's own address-bar icon. Safari and
// Firefox never fire it — there is no programmatic install there — so iOS Safari gets the manual
// share-sheet steps and everything else gets no install offer at all (see installPath()).
//
// Two per-device flags, both raw localStorage keys like DEMO_SEEDED in demo.js — device facts,
// not app state, so never synced to a profile or cleared on sign-out (clearLocalSession in
// store/useStore.js): a 7-day snooze after "Not now" or a natively declined dialog, and an
// "installed" mark. The latter exists because the tab an install was triggered from keeps running
// as a plain browser tab (the installed app opens in its own window), so isStandalone() alone
// would stay false there and the UI would fall back to "here's how to install" right after a
// successful install. It is cleared again the moment a fresh beforeinstallprompt arrives —
// Chromium only fires that while the app is NOT installed, so it is proof of an uninstall.
import { useSyncExternalStore } from 'react'
import { MOBILE } from './mobile.js'
import { IS_ANDROID, IS_IOS } from './api.js'
import { inAppBrowser } from './inapp.js'
import { t } from './i18n-core.js'

export const INSTALL_SNOOZED = 'gym_install_snoozed_v1'
export const SNOOZE_MS = 7 * 24 * 3600 * 1000
export const INSTALLED = 'gym_install_installed_v1'

// The "⋮ menu → Add to Home screen" hint names Chrome's menu; Firefox, Samsung Internet and Edge
// on Android have their own, differently named, install entries, so it is Chrome-family only.
const IS_ANDROID_CHROME = IS_ANDROID && /\bChrome\/\d/.test(navigator.userAgent)
  && !/SamsungBrowser|EdgA|OPR\/|Firefox/.test(navigator.userAgent)

// `navigator.standalone` is defined (true or false) only in Safari proper — undefined inside
// WKWebView, which is what every non-Safari iOS browser is. Those have no share-sheet "Add to
// Home Screen", so the Safari steps would be wrong. In-app browsers are ruled out by name first
// (installPath, lib/inapp.js), on Android too, where Instagram's webview says "Chrome".
const isIosSafari = () => IS_IOS && 'standalone' in navigator

// True once running as the installed app — on iOS/iPadOS Safari's `navigator.standalone`,
// everywhere else the `display-mode` media query the manifest requests.
export function isStandalone() {
  try {
    return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone === true
  } catch (e) { return false }
}

export function installSnoozed() {
  try {
    const ts = Number(localStorage.getItem(INSTALL_SNOOZED))
    const age = Date.now() - ts
    // age >= 0: a timestamp written while the clock was ahead must not snooze until it is reached
    return Number.isFinite(ts) && ts > 0 && age >= 0 && age < SNOOZE_MS
  } catch (e) { return false }
}

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

const clearInstalled = () => { try { localStorage.removeItem(INSTALLED) } catch (e) { /* ignore */ } }

// The one rule for "installing makes no sense on this device": the Capacitor build has no browser
// to install from, and an app already running standalone or marked installed is done. Shared by
// shouldOfferInstall() and Settings so the two surfaces cannot drift.
export const alreadyInstalled = () => MOBILE || isStandalone() || isInstalled()

export const shouldOfferInstall = () => !alreadyInstalled() && !installSnoozed()

export const canPrompt = () => !!deferred

// Which install path this browser has right now: 'prompt' (a captured event — any Chromium,
// desktop included), 'ios' (Safari's share sheet), 'android' (Chrome's menu, while the event
// hasn't fired), or null (nothing worth describing — desktop Firefox/Safari, in-app WebViews…).
export function installPath() {
  if (inAppBrowser()) return null   // nothing installs from in there: OpenInBrowser says where to go
  if (canPrompt()) return 'prompt'
  if (IS_IOS) return isIosSafari() ? 'ios' : null
  if (IS_ANDROID_CHROME) return 'android'
  return null
}

// The manual-steps line for a non-prompt path. Both strings predate this module and are
// translated in every locale pack.
export function manualInstallHint(path) {
  if (path === 'ios') return t('In Safari: Share → Add to Home Screen')
  if (path === 'android') return t('In Chrome: ⋮ menu → Add to Home screen')
  return null
}

// Fires the previously captured native install dialog and resolves with its outcome —
// 'accepted' | 'dismissed' | 'unavailable' (nothing captured: no API, or already spent).
//
// The event is single-use, so it is dropped synchronously; subscribers are told only once the
// dialog is answered, so no surface re-renders to "nothing to offer" while it is still open.
// A native decline gets the same 7-day quiet as "Not now" — the browser will re-fire the event
// on a later visit and the card would otherwise be back on every load. prompt() rejects (e.g.
// NotAllowedError without user activation) propagate to the caller's handler.
export async function promptInstall() {
  const e = deferred
  if (!e) return 'unavailable'
  deferred = null
  try {
    await e.prompt()
    const { outcome } = await e.userChoice
    if (outcome === 'accepted') markInstalled()
    else snoozeInstall()
    return outcome
  } finally {
    notify()
  }
}

// Captures beforeinstallprompt as early as possible — call once from main.jsx, before React
// mounts, since Chrome can fire the event before any component exists to subscribe to it. The
// `initialized` guard makes a second call a no-op.
export function initInstall() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()   // suppress the browser's own mini-infobar; our UI offers it instead
    deferred = e
    clearInstalled()     // fired only while NOT installed — the app was uninstalled since
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
