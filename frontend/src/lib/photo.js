/* Progress photos — the client half.
 *
 * The tape says what changed and adherence says whether they turned up; a photo is the only
 * thing on a coach's screen that a client also recognises about themselves. It rides the weekly
 * check-in rather than living on a screen of its own, because that is the one moment someone has
 * already stopped to answer questions about the week — a separate photo habit is a second habit,
 * and second habits do not get built.
 *
 * WHY EVERY PHOTO IS RE-DRAWN ON A CANVAS BEFORE IT LEAVES THE PHONE. Two reasons, and the
 * second is the one that matters.
 *
 * A 48 MP phone photo is 8-12 MB and nobody judging a back double-biceps can see past 1600 px,
 * so the resize is most of the upload time and most of the storage, gone for nothing lost.
 *
 * And a <canvas> holds decoded RGBA pixels and nothing else. There is no metadata surface on it,
 * so `toBlob()` encodes those pixels into a brand-new file that carries no EXIF whatsoever — no
 * GPS, no DateTimeOriginal, no camera make, model or serial. Progress photos are taken at home,
 * in a bathroom, and a server quietly accumulating forty clients' home coordinates is a
 * liability nobody agreed to when they signed up for coaching.
 *
 * Be precise about what that is and is not, because the UI copy has to be true. It holds for
 * every photo this app sends, which in practice is every photo that exists. It is NOT a boundary
 * the server can rely on: POST /api/media/photo takes raw bytes and curl can post a GPS-bearing
 * JPEG straight at it. api/ has no EXIF parser and no dependency budget for one, so the sheet
 * says what this code does ("resized on your phone before it is sent") rather than promising
 * something the server enforces. api/domain.mjs makes the same argument about GIF from the other
 * side: the canvas is a convenience on the way out of the phone, not a gate.
 *
 * Two things the strip also takes, worth knowing before reading a photo that looks wrong:
 *
 *   · **Orientation.** The EXIF Orientation tag goes with the GPS, so whatever the decode
 *     produced is baked in permanently with no tag left for anything downstream to correct.
 *     That makes the choice of decoder a correctness question — see `decode` below.
 *   · **The ICC profile.** A Display P3 iPhone photo re-encodes as untagged data everything
 *     downstream will assume is sRGB, so it comes back slightly flatter than the original.
 *     Nothing reports it and nothing can undo it. It is consistent week over week, which is what
 *     a comparison needs, and it is the price of the strip above.
 */

/** The long edge every stored photo is fitted into. Also asserted in api/domain.mjs's comment
 *  about why photos, unlike video, need no transcode flag. */
export const PHOTO_MAX_EDGE = 1600
/** JPEG quality. High enough that skin and shadow definition survive, low enough that a week of
 *  three angles is under a megabyte. */
export const PHOTO_QUALITY = 0.82

/** Stable ids — they are a query parameter and a key in the server's sidecar file, so renaming
 *  one orphans every photo already filed under it. A closed set rather than a free-text label
 *  because the whole value is comparing like with like: this week's front against March's. */
export const POSES = [
  { id: 'front', label: 'Front view' },
  { id: 'side', label: 'Side view' },
  { id: 'back', label: 'Back view' },
]

/* The paired mobile build cannot render these, so it does not offer them.
 *
 * An <img> resolves its src against the WebView's own origin (capacitor://localhost) and carries
 * no Authorization header, so every thumbnail would fail — the same reason lib/exercises.js
 * drops coach demo rows on that build. The upload itself would work, since it goes through
 * lib/api.js and its remote base; a feature that can send a photo and can never show it back is
 * worse than one that is honestly absent. VITE_MOBILE is a build-time constant, so this whole
 * branch folds away in the web bundle.
 *
 * The coach's half (views/coach/parts.jsx PhotosCard) reads the same flag but does NOT hide: a coach seeing
 * no card cannot tell it apart from a client who sent nothing, so that side says out loud that
 * the photos are there and open in the browser. */
export const PHOTOS_REACHABLE = (import.meta.env || {}).VITE_MOBILE !== '1'

/**
 * Fit w×h inside a box of `max` on the long edge. Pure, and the only part of this module a unit
 * test can reach — there is no canvas in this repo's test environment, so the draw and the
 * encode are covered from the other side, by backend/tests/Feature/PhotoTest.php.
 *
 * Never scales UP: a photo someone sent from an old phone at 900 px is stored at 900 px rather
 * than interpolated to 1600 and made to look worse at a larger file size.
 *
 * @returns {{w:number,h:number}|null} null for anything that is not a real pair of dimensions,
 * which is what a decode that produced nothing looks like.
 */
export function fitWithin(w, h, max = PHOTO_MAX_EDGE) {
  if (!(w > 0) || !(h > 0) || !(max > 0)) return null
  const k = Math.min(1, max / Math.max(w, h))
  // Math.max(1, …) covers the extreme panorama: a 1×20000 strip rounds its short edge to 0,
  // and a canvas of width 0 encodes to nothing at all rather than to a thin image.
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/* Decode a picked File through an <img>, and NOT through createImageBitmap. That is the
 * orientation decision, not a preference.
 *
 * Because toBlob() strips the Orientation tag along with the GPS, whichever way up the decoder
 * hands the pixels over is the way up the photo is stored forever. createImageBitmap defaults to
 * imageOrientation:'none', and its { imageOrientation: 'from-image' } option is a dictionary
 * member that is silently IGNORED where it is not implemented — an option that is either
 * honoured or quietly not is the worst possible shape for a decision with no second chance, and
 * it is exactly how every portrait photo from an iPhone ends up stored on its side.
 *
 * An <img> applies orientation through the CSS `image-orientation: from-image` initial value,
 * which drawImage honours, and does so the same way in every browser this app runs in. One path,
 * nothing to disagree with itself.
 */
function decode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    // Revoked on BOTH paths, success and failure. A photo picked, rejected and picked again
    // would otherwise pin every attempt's full-resolution bitmap for the life of the tab.
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')) }
    img.src = url
  })
}

// toBlob is callback-based and may call back with NULL — an encoder the browser declines, or a
// canvas it could not allocate. Left unchecked that resolves undefined and the upload sends the
// string "null" at a route that would refuse it with a message about file formats.
const encode = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(
    b => (b ? resolve(b) : reject(new Error('That photo could not be prepared — try a smaller one.'))),
    'image/jpeg', quality)
})

/**
 * A picked File → the Blob that actually gets uploaded. Always JPEG, whatever was picked.
 *
 * That deliberately narrows what the server sees relative to what it accepts (jpg/png/webp/gif,
 * api/domain.mjs) and the asymmetry is correct: the raw-bytes route has to keep accepting all
 * four because it is a raw-bytes route, while this path has one job and one output format.
 */
export async function preparePhoto(file, max = PHOTO_MAX_EDGE) {
  const img = await decode(file)
  const box = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, max)
  if (!box) throw new Error('That image could not be read.')
  const canvas = document.createElement('canvas')
  canvas.width = box.w
  canvas.height = box.h
  canvas.getContext('2d').drawImage(img, 0, 0, box.w, box.h)
  try {
    return await encode(canvas, PHOTO_QUALITY)
  } finally {
    // iOS Safari does not promptly collect a canvas backing store, and this one is up to
    // 1600×1600×4 bytes. Zeroing the dimensions releases it now rather than at some GC's leisure,
    // which matters when three poses are prepared one after another on a phone.
    canvas.width = 0
    canvas.height = 0
  }
}

/** The bytes URL for one row. Shaped like mediaRowSrc in lib/exercises.js and a separate route
 *  on purpose: that one is readable by every signed-in member, this one is checked per member on
 *  every request. `userId` is the owner — omitted, the server reads it as the caller's own. */
export const photoSrc = (row, userId) =>
  '/api/media/photo?id=' + encodeURIComponent(row.id) + (userId ? '&u=' + encodeURIComponent(userId) : '')

const POSE_ORDER = POSES.map(p => p.id)
// Unknown poses sort last rather than first: indexOf returns -1, and a row an operator or a
// future version wrote would otherwise jump ahead of the three real angles.
const poseRank = p => { const i = POSE_ORDER.indexOf(p && p.pose); return i < 0 ? POSE_ORDER.length : i }

/**
 * Rows grouped by check-in period, newest period first, angles in their canonical order.
 *
 * The grouping key is the period date the client filed the photo under — the same key
 * lib/checkins.js files the check-in itself under. That is the whole join: no id on the check-in
 * row pointing at a photo, and therefore nothing for upsertCheckin to silently drop the next
 * time someone edits their answers.
 */
export function photosByPeriod(rows) {
  const by = new Map()
  for (const p of rows || []) {
    if (!p || typeof p.d !== 'string' || !p.d || typeof p.id !== 'string' || !p.id) continue
    if (!by.has(p.d)) by.set(p.d, [])
    by.get(p.d).push(p)
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([d, list]) => ({ d, photos: list.slice().sort((a, b) => poseRank(a) - poseRank(b)) }))
}

/** The photos filed for one period, keyed by pose — what the check-in sheet fills its three
 *  slots from. */
export function posesFor(rows, d) {
  const out = {}
  for (const p of rows || []) if (p && p.d === d && POSE_ORDER.includes(p.pose)) out[p.pose] = p
  return out
}
