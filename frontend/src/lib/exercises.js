import { EXDB } from './exercises-data.js'
import { USER_EXERCISE_MUSCLE_OVERRIDES, exerciseMuscleMetadataFor } from './exercise-muscle-batch-1.js'
import { t, getVersion, getLang, DEFAULT_LANG, localExerciseName, exerciseNameSearchText } from './i18n-core.js'
import { coachMediaFor, isPhotoRow, isVideoRow } from './coach-media.js'

export { EXDB }

// The generated dataset remains the compatibility/raw export. The runtime catalogue applies
// owner-approved muscle metadata as a narrow overlay, so imports and historical tests that rely
// on the upstream shape keep working while EXIDX and pickers see the corrected model.
const catalogueExercise = ex => {
  const metadata = exerciseMuscleMetadataFor(ex?.id)
  if (!Object.keys(metadata).length) return ex
  const out = { ...ex, ...metadata }
  const user = USER_EXERCISE_MUSCLE_OVERRIDES[ex?.id] || {}
  // A future dataset row may carry explicit arrays of its own; preserve those over generated
  // defaults unless the owner has deliberately supplied a correction for the same field.
  for (const key of ['primaries', 'secondaries']) {
    if (Object.prototype.hasOwnProperty.call(ex, key) && !Object.prototype.hasOwnProperty.call(user, key)) out[key] = ex[key]
  }
  if (Array.isArray(out.primaries)) out.primaries = [...out.primaries]
  if (Array.isArray(out.secondaries)) out.secondaries = [...out.secondaries]
  return out
}

const NAME_FIXES = {
  '0739': 'sled 45° leg press',
  '1463': 'sled 45° leg press (side view)'
}

// Name fixes ride on top of the muscle-metadata pass so there is exactly one CATALOGUE:
// two dataset rows carry a name this fork corrects (see NAME_FIXES below).
export const CATALOGUE = EXDB.map(e => {
  const withMuscles = catalogueExercise(e)
  return NAME_FIXES[e.id] ? { ...withMuscles, n: NAME_FIXES[e.id] } : withMuscles
})

// The generated dataset already supplies secondary muscles for most exercises. Keep the
// handful of conservative catalogue additions that are useful to the muscle map here so a
// dataset refresh does not erase them. Values follow the dataset's existing alias vocabulary.
const SECONDARY_ADDITIONS = {
  '0027': ['rear deltoids'], // barbell bent over row
  '0293': ['rear deltoids'], // dumbbell bent over row
  '0499': ['rear deltoids'], // inverted row
  '0861': ['rear deltoids'], // cable seated row
}

// Secondary muscles for an exercise, with the small conservative additions applied as an
// overlay. The raw dataset is never mutated - consumers that want the pristine catalogue
// (export, print, import) keep reading EXDB untouched, while the muscle map sees the
// enriched list. Values follow the dataset's existing alias vocabulary.
export const smOf = ex => {
  const base = Array.isArray(ex?.sm) ? ex.sm : (ex?.sm ? [ex.sm] : [])
  return [...new Set([...base, ...(SECONDARY_ADDITIONS[ex?.id] || [])])]
}

// Two names in the generated dataset are unusable as-is: 0739's is mojibake (it stores
// "sled 45в° leg press"), and its clean twin 1463 carries a camera-angle suffix that reads as
// nonsense in a routine row. Corrected the same way SECONDARY_ADDITIONS is - an overlay, so a
// dataset refresh cannot quietly undo it and EXDB itself stays pristine for anyone who wants
// the raw catalogue.
export const EXIDX = {}
CATALOGUE.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(CATALOGUE.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => {
    delete EXIDX[id]
    const builtIn = CATALOGUE.find(ex => ex.id === id)
    if (builtIn) EXIDX[id] = builtIn
  })
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// The built-ins in the reader's alphabetical order. EXDB is stored in English order, so a French
// or Spanish list ran "Sit-up 3/4, Flexion latérale…, Crunch bicyclette" (CHW-209). Sorted by the
// translated name with the language's own collation, once per language change; English keeps
// the stored order untouched.
let orderedFor = -1, ordered = CATALOGUE
function catalogueInOrder() {
  if (orderedFor !== getVersion()) {
    orderedFor = getVersion()
    const lang = getLang()
    ordered = lang === DEFAULT_LANG ? CATALOGUE : [...CATALOGUE].sort((a, b) =>
      localExerciseName(a).localeCompare(localExerciseName(b), lang, { sensitivity: 'base', numeric: true }))
  }
  return ordered
}

// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...catalogueInOrder()]

function searchableText(value) {
  if (Array.isArray(value)) return value.map(searchableText).join(' ')
  if (value == null) return ''
  try { return String(value) } catch { return '' }
}

/** Case-insensitive search over built-in and legacy custom exercise metadata. */
function isSubsequence(needle, hay) {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

// Fuzzy match score for one exercise against a query. Best hits: exact field match, then
// field prefix, then word-boundary starts, then substrings (closer to the start scores
// better), and finally typo-tolerant ordered subsequences. Fields are weighted - the name
// dominates, target/equipment matter, muscles and description are supporting evidence.
// 0 means no match, so matchesExerciseSearch stays a boolean filter while the picker can
// rank results by score. Accent-insensitive, and the name is both the translated and the
// English one (exerciseNameSearchText), like matchExercise: "developpe" finds "développé".
export function searchScore(exercise, query) {
  const needle = normalizeStr(searchableText(query)).trim()
  if (!needle) return 1
  const source = exercise && typeof exercise === 'object' ? exercise : {}
  const fields = [['n', 100], ['tg', 40], ['eq', 40], ['sm', 30], ['muscleGroups', 30], ['primaries', 30], ['secondaries', 30], ['desc', 10], ['cues', 10]]
  // Token-level matching: every query word must match somewhere (any order), so
  // "press bench" finds "Bench Press". The score sums each token's best hit.
  const tokens = needle.split(/[^a-z0-9]+/).filter(Boolean)
  if (!tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    let best = 0
    for (const [field, weight] of fields) {
      const hay = normalizeStr(field === 'n' ? exerciseNameSearchText(source) : searchableText(source[field]))
      if (!hay) continue
      if (hay === token) best = Math.max(best, weight * 4)
      else if (hay.startsWith(token)) best = Math.max(best, weight * 3)
      const idx = hay.indexOf(token)
      if (idx > 0) best = Math.max(best, weight * 2 - Math.min(idx, 20) * 0.5)
      if (hay.split(/[^a-z0-9]+/).some(w => w.startsWith(token))) best = Math.max(best, weight * 2.5)
      if (isSubsequence(token, hay)) best = Math.max(best, weight + Math.max(0, 10 - (hay.length - token.length)))
    }
    if (!best) return 0 // every token must match
    total += best
  }
  return total
}

export function matchesExerciseSearch(exercise, query) {
  return searchScore(exercise, query) > 0
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment. `import.meta.env` is undefined in plain
// Node; the guard keeps this module loadable without Vite.
const ENV = import.meta.env || {}
const IMG_BASE = ENV.VITE_IMG_BASE || 'img/'
const GIF_BASE = ENV.VITE_GIF_BASE || 'gif/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif

// A coach's own demo of an exercise, and the chain behind it.
//
// Deliberately NOT routed through imgSrc/gifSrc, because they are two different worlds that
// happen to end up in the same <div>: IMG_BASE/GIF_BASE are frozen at BUILD time and on the
// real deploy point at a CDN on another host, while a coach demo is a same-origin, session-gated
// API path resolved at RUNTIME. Same exercise, two hosts, two auth models, two cache stories.
//
// Keying on the exercise id is also what finally gives CUSTOM exercises media: the stock dataset
// has no row for "Ahmed's cable variation", so ex.gif is empty and always will be.
//
// KNOWN LIMIT, stated rather than papered over: this is a same-origin path carrying the session
// cookie, which is right in a browser and cannot work at all on the PAIRED mobile build, where
// auth is a Bearer token against a remote base and a <video src> element cannot carry a header —
// the path is not even resolved against that base, so it lands on the Capacitor WebView's own
// origin and 404s. Blob-fetch-then-object-URL would fix it and would also throw away the
// Range/206 streaming serveMedia exists to provide, on a 90 MB file, on a phone. Not worth it
// until someone actually pairs a phone against an instance that has demos.
//
// So on that build the rows are dropped here instead of being handed out as URLs that are known
// to fail. Letting them through is not a graceful degrade: a dataset exercise burns a failed
// request per card to arrive at the gif it would have shown anyway, and a CUSTOM exercise — which
// has no gif and no jpg beneath the video, ever — degrades to a permanent grey broken tile where
// the build before demos existed simply drew nothing. VITE_MOBILE is a build-time constant, so
// this whole branch folds away in the web bundle, exactly like VITE_IMG_BASE above.
const MEDIA_EX = '/api/media/ex?id='
const COACH_MEDIA_REACHABLE = ENV.VITE_MOBILE !== '1'
export const mediaRowSrc = row => MEDIA_EX + encodeURIComponent(row.id)

// The whole fallback chain, pure, taking the coach rows rather than reaching for the registry —
// so it is testable without a fetch, a cache or a DOM. The callers below bind it to the registry.
//
//   animation:  coach video → stock GIF → nothing
//   still:      coach photo → stock JPG → nothing (the caller draws the dumbbell glyph)
export function resolveMedia(ex, rows) {
  const list = COACH_MEDIA_REACHABLE && Array.isArray(rows) ? rows : []
  const vid = list.find(isVideoRow)
  const pic = list.find(isPhotoRow)
  const gif = ex && ex.gif ? gifSrc(ex) : null
  const poster = pic ? mediaRowSrc(pic) : (ex && ex.img ? imgSrc(ex) : null)
  // What a <video> may show BEFORE it has decoded a frame — and deliberately not `poster` above.
  // That one falls back to the dataset still, which is a photograph of a stranger doing the lift:
  // putting it over the coach's own footage is worse than showing nothing, because it reads as
  // the demo itself until the video starts. With no poster the browser paints the video's own
  // first frame instead, which is what a filmed demo should look like.
  //
  // A coach-uploaded photo IS used, because that one they chose. Generating a real poster frame
  // from the video needs ffmpeg, which is the step this fork has not taken.
  // `pic ? poster : null`, not a second `mediaRowSrc(pic)`: the invariant is "the same photo the
  // chain would use, minus the dataset fallback", and re-deriving the first rung means a change to
  // how `pic` is chosen up there silently leaves this behind.
  const videoPoster = pic ? poster : null
  return {
    video: vid ? mediaRowSrc(vid) : null,
    // 'raw' does not mean broken. It means nothing has yet confirmed a browser can decode this
    // — an iPhone's HEVC in a .mov is the case, and Chrome and Firefox are where it bites.
    // Nothing in the API ever flips it, so it is shown and played, and marked, not hidden.
    raw: !!vid && vid.status === 'raw',
    label: vid ? String(vid.label || '') : '',
    gif,
    poster,
    videoPoster,
    // Whether there is anything at all to draw. This is the gate Media.jsx opens on, and it is
    // the reason a custom exercise can finally render something.
    any: !!(vid || gif || pic)
  }
}

export const videoSrc = ex => resolveMedia(ex, coachMediaFor(ex && ex.id)).video
export const posterSrc = ex => resolveMedia(ex, coachMediaFor(ex && ex.id)).poster
export const hasMedia = ex => resolveMedia(ex, coachMediaFor(ex && ex.id)).any

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
// Equipment with no meaningful load in kg: your own body, or a band whose "weight" is a colour.
// Both default to the bodyweight model (one reps stepper, progression in reps then sets); the
// per-exercise Bodyweight switch still overrides it either way (issue #39).
const BODYWEIGHT_EQ = new Set(['body weight', 'band', 'resistance band'])
export const isBodyweightEq = idOrEx =>
  BODYWEIGHT_EQ.has((typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq)

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }

// Normalizes text by lowercasing and stripping diacritics/accents (e.g. "elevação" -> "elevacao")
export const normalizeStr = s => (s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

// Multi-token, accent-insensitive and multilingual exercise search.
// Matches when all whitespace-separated words in the query appear anywhere in the exercise's
// name, equipment, target muscle, body part (both in English and translated to active language),
// secondary muscles or description.
//
// The haystack is built once per exercise and cached: NFD-normalising ~1300 catalogue entries
// on every keystroke costs ~8ms on a desktop and several times that on a phone. The cache key
// is the i18n version (bumped by every setLang), so switching language rebuilds the translated
// terms. Custom exercises are re-cached automatically — the store clones state on update, so an
// edited exercise arrives as a new object the WeakMap has never seen.
const corpusCache = new WeakMap()

function corpusOf(e) {
  const v = getVersion()
  const hit = corpusCache.get(e)
  if (hit && hit.v === v) return hit.s
  const sm = Array.isArray(e?.sm) ? e.sm : []
  const s = normalizeStr([
    exerciseNameSearchText(e),
    e?.tg || '', t(e?.tg || ''),
    e?.eq || '', t(e?.eq || ''),
    e?.bp || '', t(e?.bp || ''),
    ...sm, ...sm.map(m => t(m)),
    e?.desc || ''
  ].join(' '))
  corpusCache.set(e, { v, s })
  return s
}

export function matchExercise(e, query) {
  if (!query) return true
  const tokens = normalizeStr(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  if (!e || typeof e !== 'object') return false
  const corpus = corpusOf(e)
  return tokens.every(tok => corpus.includes(tok))
}
