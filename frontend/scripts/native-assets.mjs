#!/usr/bin/env node
// Writes every native app icon and launch screen from resources/icon.svg, so the Android and iOS
// shells show the same One Spine mark (brand/logo-kit) as the PWA and the website.
//
//   npm run assets:native
//
// This replaces `npx @capacitor/assets generate`, which got three things wrong for this app:
// it makes the adaptive-icon layers at legacy size and Android blows them up 1.5x (soft edges);
// it pads the pre-8.0 icons by a fixed 8px, so the icon shrinks on low-density screens; and it
// makes the Android launch screen a full-window bitmap, which Android stretches to the screen's
// shape. So:
//   - Android 8+ icon: a colour background and a vector foreground, sharp at any density.
//   - Android 6-7 icons: PNGs rendered at each density's exact size, with proportional margins.
//   - Android launch screen: one vector symbol on a colour, set in styles.xml as the two
//     windowSplashScreen* items. Android 12+ draws it natively; below 12 the compat
//     Theme.SplashScreen makes it the window background, the same size and place. Never stretched.
//   - iOS: the 1024 app icon and the 2732 launch image (the storyboard aspect-fills it).
// The launch screens use capacitor.config.json's backgroundColor (black): it is the WebView's
// colour behind the app, so anything else is a visible colour jump when the app takes over.
//
// Everything comes from icon.svg: the symbol is its one <path> (its size and position are measured
// from the path, not typed in), the gold is that path's fill and the graphite is its <rect>'s.
// PNGs are rendered with sharp, pinned in devDependencies so the output is the same byte for byte.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const fail = (msg) => { throw new Error(`native-assets: ${msg}`) }

// ---- the source
const ICON = readFileSync(root + 'resources/icon.svg', 'utf8')
const tags = (name) => [...ICON.replace(/<!--[\s\S]*?-->/g, '').matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => m[0])
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const one = (name) => {
  const found = tags(name)
  if (found.length !== 1) fail(`resources/icon.svg must have exactly one <${name}> (found ${found.length})`)
  return found[0]
}
const PATH = one('path'), TILE = one('rect')
const D = attr(PATH, 'd') ?? fail('the <path> in resources/icon.svg has no d attribute')
const GOLD = attr(PATH, 'fill') ?? fail('the <path> in resources/icon.svg has no fill')
const GRAPHITE = attr(TILE, 'fill') ?? fail('the <rect> in resources/icon.svg has no fill')
const LAUNCH = JSON.parse(readFileSync(root + 'capacitor.config.json', 'utf8')).backgroundColor
  ?? fail('capacitor.config.json has no backgroundColor')
// The two contours wind in opposite directions, so the default non-zero fill already leaves the
// counter open. That matters on Android 6, where vector drawables ignore fillType.

// The ink box of a path made of M/L/H/V/C/Z commands (absolute or relative), from its geometry:
// every endpoint, plus each curve sampled finely enough to find its extremes.
const inkBox = (d) => {
  const tok = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const see = (px, py) => { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py) }
  const num = () => (i < tok.length && !/[a-zA-Z]/.test(tok[i]) ? +tok[i++] : fail(`path data ends early after "${cmd}"`))
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++]
    else if (!cmd) fail('path data must start with a command')
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; see(x, y); cmd = rel ? 'l' : 'L'; break
      case 'L': x = ox + num(); y = oy + num(); see(x, y); break
      case 'H': x = ox + num(); see(x, y); break
      case 'V': y = oy + num(); see(x, y); break
      case 'C': {
        const p = [x, y, ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]
        for (let k = 1; k <= 256; k++) {
          const t = k / 256, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t
          see(a * p[0] + b * p[2] + c * p[4] + e * p[6], a * p[1] + b * p[3] + c * p[5] + e * p[7])
        }
        x = p[6]; y = p[7]; break
      }
      case 'Z': x = sx; y = sy; break
      default: fail(`path command "${cmd}" is not supported; use M, L, H, V, C or Z`)
    }
  }
  if (x0 === Infinity) fail('the symbol path is empty')
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
const INK = inkBox(D)
const CX = INK.x + INK.w / 2, CY = INK.y + INK.h / 2

const out = (rel, data) => {
  const p = root + rel
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
  console.log('wrote', rel)
}
const n = (v) => +v.toFixed(4)

// symbol `h` units tall, centred on (cx, cy - up)
const place = (h, cx, cy, up = 0) => {
  const s = h / INK.h
  return { s: n(s), tx: n(cx - CX * s), ty: n(cy - up - CY * s) }
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()

// ---- Android
const RES = 'android/app/src/main/res/'
const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

// a w x h dp vector drawable with the symbol symH tall in its centre
const vector = (w, h, symH, up = 0) => {
  const { s, tx, ty } = place(symH, w / 2, h / 2, up)
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/native-assets.mjs from resources/icon.svg. Do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${n(w)}dp" android:height="${n(h)}dp"
    android:viewportWidth="${n(w)}" android:viewportHeight="${n(h)}">
    <group android:scaleX="${s}" android:scaleY="${s}" android:translateX="${tx}" android:translateY="${ty}">
        <path android:fillColor="${GOLD}" android:pathData="${D}" />
    </group>
</vector>
`
}

// Adaptive icon (Android 8+): 108dp layers, 72dp visible, 66dp safe circle. The symbol is 39.4dp
// tall, about the weight of the iOS icon's; its corners stay inside the safe circle.
out(RES + 'drawable-v24/ic_launcher_foreground.xml', vector(108, 108, 39.4, 0.5))
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/native-assets.mjs. Full-size layers, no inset: an inset scales the
     layers up from a smaller bitmap, which is what made the old icon soft. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`
out(RES + 'mipmap-anydpi-v26/ic_launcher.xml', adaptive)
out(RES + 'mipmap-anydpi-v26/ic_launcher_round.xml', adaptive)
out(RES + 'values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/native-assets.mjs. -->
<resources>
    <color name="ic_launcher_background">${GRAPHITE}</color>
    <color name="launch_background">${LAUNCH}</color>
</resources>
`)

// Launch screen, every Android version: the symbol 120dp tall in a 288dp canvas, the size both
// Android 12+ and the compat theme draw windowSplashScreenAnimatedIcon at. Only a 192dp circle of
// it shows, so the symbol's corners must stay inside that.
out(RES + 'drawable/splash_icon.xml', vector(288, 288, 120))

// Android 6-7 icons. Same proportions at every density: the tile is 88% of the canvas (the
// launcher grid's usual margin), the symbol 44% of it, as on the iOS icon.
for (const [dpi, k] of Object.entries(DENSITIES)) {
  const px = Math.round(48 * k), m = px * 0.06, t = px - 2 * m
  const { s, tx, ty } = place(px * 0.44, px / 2, px / 2, px * 0.008)
  const mark = `<path fill="${GOLD}" transform="matrix(${s} 0 0 ${s} ${tx} ${ty})" d="${D}"/>`
  const svg = (tile) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${tile}${mark}</svg>`
  out(`${RES}mipmap-${dpi}/ic_launcher.png`,
    await png(svg(`<rect x="${m}" y="${m}" width="${t}" height="${t}" rx="${t * 0.18}" fill="${GRAPHITE}"/>`)))
  out(`${RES}mipmap-${dpi}/ic_launcher_round.png`,
    await png(svg(`<circle cx="${px / 2}" cy="${px / 2}" r="${t / 2}" fill="${GRAPHITE}"/>`)))
}

// ---- iOS
const XC = 'ios/App/App/Assets.xcassets/'
// App icon: icon.svg itself, flattened, because the App Store rejects an icon with alpha.
{
  const icon = sharp(Buffer.from(ICON))
  const { width, height } = await icon.metadata()
  if (width !== 1024 || height !== 1024) fail(`resources/icon.svg must render at 1024x1024 (it is ${width}x${height})`)
  out(XC + 'AppIcon.appiconset/AppIcon-512@2x.png', await icon.flatten({ background: GRAPHITE }).png({ compressionLevel: 9 }).toBuffer())
}

// Launch image: 2732 square, symbol 440 tall, opaque. LaunchScreen.storyboard aspect-fills it, so
// a phone shows the symbol about 136pt tall and never distorted. One file for every scale: the
// fill is relative to the view, so a @2x or @3x copy would draw the same. One appearance: the app
// is dark anyway.
{
  const S = 2732, { s, tx, ty } = place(440, S / 2, S / 2), file = 'splash-2732.png'
  out(`${XC}Splash.imageset/${file}`, await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`
    + `<path fill="${GOLD}" transform="matrix(${s} 0 0 ${s} ${tx} ${ty})" d="${D}"/></svg>`))
    .flatten({ background: LAUNCH }).png({ compressionLevel: 9 }).toBuffer())
  out(XC + 'Splash.imageset/Contents.json', JSON.stringify({
    images: [{ idiom: 'universal', filename: file }],
    info: { version: 1, author: 'xcode' },
  }, null, 2) + '\n')
}
