import { create } from 'zustand'
import { setShellPref } from '../lib/role.js'
import { forgetCoachSecrets } from '../lib/forget-coach.js'
import { api, setRemoteAuth, passkeyLogin, signInWithCode } from '../lib/api.js'
import { localTZ, todayISO } from '../lib/format.js'
import { compactMeals } from '../lib/nutrition.js'
import { emptyHealth } from '../lib/health-consent.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { plansOn } from '../lib/billing.js'
import { MOBILE, initReminderSync, nativeLoad, nativeSave, syncReminder, writeAutoBackup } from '../lib/mobile.js'
import { loadRemote, chooseLocal, forgetRemote, connect } from '../lib/remote.js'
import { browserLang } from '../lib/i18n-core.js'

import { WC_DEFAULT } from '../lib/workout-controls.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, timerFlash: false, keepAwake: true, lang: browserLang(),
  theme: 'dark', accent: 'gold', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  // Tape measurements, shaped like bodyweight so they ride the same sync and chart with the
  // same component: [{ d, site, v, t }], one per site per day. See lib/measurements.js.
  measurements: [],
  // Weekly check-ins: [{ d, answers: { energy: 4, … }, note?, t }], one per period. The client
  // authors them and the coach reads them out of the same synced blob — anything the server
  // wrote here would be destroyed by the client's next push. See lib/checkins.js.
  checkins: [],
  // Which weekday check-ins fall on (0 = Sunday). null means the default, so a profile written
  // before this existed is not pinned to a day nobody chose.
  checkinDay: null,
  // Food logged today and for the last four months: [{ id, d, n, g, kcal, p, c, f, s, t }]. The
  // macros are DENORMALISED onto each entry — already scaled for the grams — and `s` is
  // provenance, never a key anything resolves. That is what lets a meal be logged in a kitchen
  // with no signal and read back years later after the food it came from was renamed or deleted.
  // Here in the blob rather than behind endpoints of its own so it rides the sync, the dirty flag
  // and the retry that workouts already have. See lib/nutrition.js.
  meals: [],
  // Entries past 120 days, rolled to four numbers a day: { '2026-01-04': [kcal, p, c, f] }.
  // Meals are the first thing in this blob written several times a DAY, and the whole state is
  // re-serialised to localStorage and pushed on every change — unrolled, a year of them is the
  // largest single thing here (compactMeals, lib/nutrition.js).
  mealDays: {},
  // The ~200 foods this person actually eats, per 100 g, most recently used first: there is no
  // food database behind this and v1 does not pretend otherwise. Kept in use order so searching
  // it needs no ranking pass.
  foods: [],
  // Daily targets: { kcal, p, c, f, note?, t }, any subset. Written by the CLIENT when it accepts
  // a coach's program — the bundle carries an optional `nutrition` key (api/domain.mjs). It
  // cannot arrive any other way: the server writing it into state-<uid>.json would be destroyed
  // by this client's next whole-state push.
  nutriTarget: null,
  // Coaches only: named programs written for clients, kept out of `routines` so that progressing
  // a client never changes what the coach themselves trains tomorrow. Each one is a frozen
  // snapshot of chosen routines, which is why editing your own Plan afterwards
  // leaves already-saved programs alone.
  programs: [],
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // How the active workout is laid out — 'cards' (one exercise at a time with Prev/Next),
  // 'list' (every exercise stacked and scrollable) or 'compact' (that stack stripped to just
  // names and set rows — no media, tags, notes, last-time or progression line). Purely
  // presentational: profiles written before this setting existed overlay onto DEF and keep the
  // 'cards' behaviour. beginWorkout copies the value onto s.active, so the header ⋮ menu can
  // override it for the running session without touching this saved default.
  workoutView: 'cards',
  // Which controls the workout screen shows besides the sets themselves. The default is the
  // lean layout: one "more" button per exercise and a menu on each set number. Every switch
  // brings one of the old always-visible button groups back (Settings → During a workout).
  wc: { ...WC_DEFAULT },
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null, autoBackup: false,
  // Equipment profiles (issue: filter Library/picker/routines by what you actually own —
  // e.g. "Home" vs "Gym" — building on the session-only equipment filter from issue #6).
  equipProfiles: [], activeEquipId: null, equipFilterOn: false,
  // Standing per-exercise notes, keyed by exercise id: the gym-specific facts that are true
  // every time you do the movement ("seat 4, pin 7"). Distinct from a routine's `note`, which
  // belongs to one exercise in one plan, and from a session note, which belongs to one day.
  exNotes: {},
  // Favourite exercise ids (issue #6) — sorted to the top of the picker/Library. Personal, so
  // it syncs with the profile but is never part of a shared plan bundle (lib/favourites.js).
  favEx: [],
  // First day of the week as a getDay() index — 1 Monday, 0 Sunday. Monday is the default so
  // every profile written before this setting existed keeps the week it has been looking at.
  // See lib/format.js: nothing reads this field directly, everything goes through the helpers.
  weekStart: 1,
  // Per-exercise bar weight overrides, keyed by exercise id, in the profile unit (see
  // lib/bar.js). Personal equipment, so it syncs with the account but never travels in a
  // shared plan. Logged weights stay the total — this only feeds the plate math.
  barWeights: {},
  // Gym membership codes: [{ id, label, value, fmt }], `fmt` being the barcode symbology the
  // gym issued ('qrcode' | 'ean13' | 'code128' | …). The screen that displayed them as a
  // scannable card is gone — this fork coaches people, it does not run a turnstile.
  //
  // The DATA the screen wrote stays, for two reasons. It is listed in DATA_KEYS below, which is
  // what `hasData` asks before letting a server copy overwrite a device wholesale; drop it and a
  // profile whose only records are gym cards reads as empty and gets replaced. And it is a code
  // somebody typed in by hand, still in every backup `doExport` writes, so it is theirs to
  // retrieve — unlike the AI Coach blob in GONE below, which nothing could reach.
  //
  // Nothing writes these three any more. They are kept, not revived: no screen reads them.
  gymCards: [],
  lastGymCardId: null,
  checkIn: true,
}
const clone = o => JSON.parse(JSON.stringify(o))

/**
 * Keys from features that no longer exist.
 *
 * `coach` held the AI Coach's conversation, its proposal log, its snapshots and the consent
 * record — up to ~75 KB by its own accounting. Nothing reads it now, but `S` is pushed WHOLE on
 * every sync, so without this it would ride along for ever on every device of everyone who ever
 * used the feature.
 *
 * The stronger reason is not bytes. That blob is a transcript of someone's conversation about
 * their own training, and the only screens that could show or clear it are gone — leaving it
 * would mean keeping a log the person can no longer read or delete. Dropped on the way in and on
 * the way out, so a device that still has it discards it, and the next push writes the cleaned
 * state back to the server.
 *
 * Deliberately not a general "unknown key" sweep: `S` is the client's own, and an older build
 * must be able to hold a key a newer one has not learned about yet without a downgrade eating it.
 */
const GONE = ['coach']
const forget = s => { for (const k of GONE) delete s[k]; return s }

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return forget(Object.assign(clone(DEF), JSON.parse(raw)))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

// Everything on this device a pull is allowed to destroy. It has to list every kind of record the
// client authors, because that is the only question restoredStateFor asks before letting a remote
// state win outright: a profile this returns false for is treated as empty, so the dirty flag and
// a newer local `_ts` are both skipped and the server's copy replaces it wholesale.
//
// Meals forced the widening. A meal is the first thing in this blob written several times a DAY,
// and lib/nutrition.js's whole premise is that one logged in a kitchen with no signal survives —
// a client who has signed in, logged breakfast offline and not yet made a routine or a weigh-in
// was exactly the profile the old three-key check called empty. Measurements, check-ins, foods,
// gym cards and a coach's programs had the same hole and are the same class of loss.
const DATA_KEYS = ['workouts', 'routines', 'bodyweight', 'measurements', 'checkins', 'meals', 'foods', 'customEx', 'gymCards', 'programs']
const hasData = st => DATA_KEYS.some(k => (st?.[k] || []).length) || !!Object.keys(st?.mealDays || {}).length

// Decide whether a pulled account state may replace the local saved state. A local active workout
// is deliberately carried forward: the server stores completed/saved state, while the in-progress
// session belongs to the device that is currently running it.
export function restoredStateFor(local, remote, dirty = false) {
  if (!remote || (hasData(local) && (dirty || (remote._ts || 0) < (local._ts || 0)))) return null
  const next = Object.assign(clone(DEF), remote)
  if (local.active) next.active = local.active
  return next
}

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  initReminderSync(() => get().S)

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    forget(S)
    S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
      syncReminder(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    // A push still waiting on its debounce belongs to the profile leaving. signOut has already
    // sent it; after an account switch (forgetLocalSession) it would go out under the NEW
    // session and write the old or the emptied state into that account.
    clearTimeout(pushTm); pushTm = null
    get().setUser(null)
    setShellPref('coach')   // "Train myself" belonged to the profile leaving, not to the device
    set({ syncError: null })   // whatever the server refused belonged to the profile leaving
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    // Programs a coach has sent that this member hasn't answered yet. Server-owned and never
    // persisted locally — the source of truth is the inbox, so a decision made on one device
    // doesn't leave a stale offer sitting on another.
    assignments: [],
    // The server's own words for why this device's last save was refused, or null. Only ever set
    // from a 4xx (see pushState) — a push that fails offline is not an error anyone should be
    // shown. Not persisted: the next push retries and either clears it or sets it again, so what
    // is on screen is always about the state the device is holding right now.
    syncError: null,

    // A coached client's consent to their coach seeing their health data (CHW-360): null until
    // asked for, then {required, consentAt} from the server, and dropped with the user: it is the
    // server's to say. Its date is copied onto the user, which the device keeps, for offline.
    healthConsent: null,
    keepHealthConsent(c) {
      const u = get().user
      if (u) get().setUser({ ...u, healthConsentAt: c.consentAt ?? null })
      set({ healthConsent: c })
      return c
    },
    async loadHealthConsent() {
      return get().keepHealthConsent(await api('/api/me/health-consent'))
    },
    async giveHealthConsent() {
      return get().keepHealthConsent(await api('/api/me/health-consent', { method: 'POST', body: JSON.stringify({ agree: true }) }))
    },
    // Withdrawing deletes the data: on the server first, then this device's copy, then a push so
    // the state the server holds matches.
    async withdrawHealthConsent() {
      const c = get().keepHealthConsent(await api('/api/me/health-consent/withdraw', { method: 'POST', body: '{}' }))
      get().update(emptyHealth)
      await get().pushState()
      return c
    },

    async loadAssignments() {
      if (!get().user) return set({ assignments: [] })
      try { const { assignments } = await api('/api/assignments'); set({ assignments: assignments || [] }) }
      catch { /* offline, or an older server without the route — no offers is the safe answer */ }
    },

    /* Instance capabilities from GET /api/config: whether signup needs an invite, whether guests
       are allowed, whether access can be requested. It used to carry the AI Coach's flag too;
       that feature is gone. */
    config: null,
    needsMobileOnboarding: false,   // mobile build only — set true by boot() on a genuine first launch

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    // Fold meal entries past the keep window into one row a day (lib/nutrition.js). Called from
    // the Nutrition screen on open rather than from boot(), for the reason that makes it cheap:
    // the only profiles this matters for are the ones that log food, and those are exactly the
    // ones that open that screen. compactMeals returns null when there is nothing to roll, which
    // is the overwhelmingly common case, and skipping update() there also skips a whole-state
    // clone and a push nobody asked for.
    compactNutrition() {
      const rolled = compactMeals(get().S, todayISO())
      if (rolled) get().update(s => { s.meals = rolled.meals; s.mealDays = rolled.mealDays })
    },

    // Fires after the moments where losing local data would actually hurt — a workout just
    // logged, a routine just edited — not on every keystroke. No-op off mobile or with the
    // setting off; the private file mirror (nativePersist, above) already covers every change.
    autoBackupNow() {
      const S = get().S
      if (MOBILE && S.autoBackup) writeAutoBackup(S)
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    config: null,
    async loadConfig() {
      if (get().config) return get().config
      return get().refreshConfig()
    },
    // Always asks. The cached copy is right for one boot, but an admin can switch the Coach on
    // while a paired phone sits on the setup screen — that screen wants today's answer.
    async refreshConfig() {
      try { const c = await api('/api/config'); set({ config: c }); return c }
      catch { return null }
    },

    // The coach's plan, GET /api/billing/me ({entitlement, licence, plans, portal}; lib/billing.js
    // reads it). Server-owned and never persisted, like `assignments`. Only asked on an instance
    // with plans (`billing` or `free_cap` in /api/config — the Node API has no such route) and only
    // for a coach.
    billing: null,
    async loadBilling() {
      const { config, user } = get()
      if (!plansOn(config) || !user?.coach) { if (get().billing) set({ billing: null }); return null }
      // Kept only if the same coach is still signed in when it answers: a reply landing after a
      // sign-out would otherwise put one coach's plan in front of the next on a shared device.
      const asked = user.id
      try {
        const b = await api('/api/billing/me')
        if (get().user?.id !== asked) return null
        set({ billing: b }); return b
      }
      // Offline: the last answer is still the best one there is.
      catch { return get().user?.id === asked ? get().billing : null }
    },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      // Offers belong to whoever is signed in; leaving them behind would show one profile's
      // pending program to the next person on a shared device. The plan likewise.
      set({ user: u, healthConsent: null, ...(u ? null : { assignments: [], billing: null }) })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try {
        await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) })
        localStorage.removeItem('gym_dirty')
        if (get().syncError) set({ syncError: null })
      } catch (e) {
        localStorage.setItem('gym_dirty', '1')
        // A 4xx is the server REFUSING this state, not a phone in a lift. Retrying changes
        // nothing, and PUT /api/data's 413 sends back a sentence naming the limit and what to do
        // about it — swallowing it is how a profile stops syncing forever with nothing on screen.
        // Anything without a status is offline, which resolves itself and must never put a
        // failure row in front of someone on the train — but it must not CLEAR one either. A
        // refusal is a fact about the state, not about the last request: 413 over the limit,
        // then a walk into a lift, and a bare "Failed to fetch" would wipe the only line saying
        // why nothing is syncing, while the state is still over the cap. The row goes when a
        // push actually succeeds, which is where it is cleared.
        const refused = e && Number.isInteger(e.status) && e.status >= 400 && e.status < 500
        if (refused) set({ syncError: e.message })
      }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        const restored = restoredStateFor(S, state, dirty)
        if (restored) {
          persist(restored, false)
        } else if (hasData(S)) { await get().pushState() }
        // Offers refresh on every sync, not just at boot — otherwise a member sitting in the app
        // wouldn't see a program arrive until they reloaded.
        get().loadAssignments()
      } catch (e) { /* offline — keep local */ }
    },

    // Another account has just signed in on this device without signing the last one out — an
    // emailed link opened in a browser where someone else was signed in (views/Link.jsx). The
    // session cookie is already the new account's, so nothing may be pushed: the old profile's
    // local state, dirty flag and shell choice are dropped as a sign-out drops them, and its
    // unsynced edits with them — the alternative is writing them into the new account.
    forgetLocalSession() { clearLocalSession() },

    // A passkey sign-in, as Login and the link page both do it: the user, then their synced state.
    async passkeySignIn() {
      const u = await passkeyLogin()
      get().setUser(u)
      await get().pullState()
      return u
    },
    // The emailed code (CHW-331), signed in as a passkey does.
    async codeSignIn(email, code) {
      const { user: u } = await signInWithCode(email, code)
      get().setUser(u)
      await get().pullState()
      return u
    },

    async signOut() {
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
      clearLocalSession()
    },

    // Mobile-only ("connect to my server" onboarding, see App.jsx's needsMobileOnboarding).
    // Picking local — even before there's any data — persists the choice so onboarding never
    // asks again.
    async chooseLocalMode() {
      await chooseLocal()
      set({ needsMobileOnboarding: false })
    },
    // Redeems the pairing code shown in the browser (Settings → "Pair the mobile app") and
    // switches this device over to that account, same as signing in on the web does.
    async connectToServer(url, code) {
      const user = await connect(url, code)   // throws on a bad URL/expired code — caller shows it
      get().setUser(user)
      await get().refreshConfig()   // what this server offers (the Coach, guest mode) — see boot()
      await get().pullState()
      syncReminder(get().S)
      set({ needsMobileOnboarding: false })
    },
    // Leaves remote mode and drops cleanly back to local-only, without losing whatever was last
    // synced (signOut() already pushes before it clears).
    async disconnectServer() {
      await get().signOut()
      await forgetRemote()
      get().setGuest(true)
      set({ ready: true })
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend by default — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in. Unless this
      // device was paired to a server ("connect to my server" mode, lib/remote.js), in which
      // case it behaves exactly like the signed-in web flow below, straight from here.
      if (MOBILE) {
        // Once, and never again: the provider API key and job file the AI Coach left in the
        // Keychain and the app data directory, which no surviving screen can reach. Not
        // awaited — a phone that cannot open its own keystore this morning must not delay
        // first paint over a feature that no longer exists; it retries next launch.
        forgetCoachSecrets()
        const remote = await loadRemote()
        if (remote?.mode === 'remote') {
          setRemoteAuth(remote.base, remote.token)
          try {
            const me = await api('/api/me')   // also catches a token revoked elsewhere (sign out everywhere)
            get().setUser(me.user)
            // The paired server's /api/config, the same one the web boot reads: without it the
            // phone never learned whether the server offers the Coach and told everyone "your
            // server has no Coach enabled" — with the admin looking at a green test.
            await get().loadConfig()
            await get().pullState()
          } catch (e) {
            if (e.status === 401) { await forgetRemote(); get().setGuest(true) }
            else get().setUser(remote.user)   // offline — keep going from the last-synced local copy
          }
          syncReminder(get().S)
          set({ ready: true })
          return
        }
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        // Only a genuinely first launch — nothing chosen yet and nothing to lose either — offers
        // the choice. Picking local (even with no data yet) persists that choice below and this
        // never asks again.
        set({ ready: true, needsMobileOnboarding: !remote && !hasData(get().S) })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        get().loadAssignments()   // not awaited: an offer is never worth delaying first paint for
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }