# Design

Visual system for **fitpal.ma** (`site-coach/`). Strategic context lives in `PRODUCT.md`.

Not the system for `site/` (gym.fitpal.ma, gold on black) or `frontend/` (the app, whose own tokens
live in `frontend/src/index.css`). Those are separate surfaces and deliberately look different.

## Theme

Dark, warm graphite. The physical scene that forced it: a trainer at 21:40, sitting on a bench
in a half-lit gym after the last client of the day, phone in hand, deciding whether this is
worth a call. Dim room, tired eyes, small screen.

Warm graphite rather than pure black, because black is the sibling product's ground and because
a field manual is a printed object, not a void. Every neutral is tinted toward the accent's warm
hue (chroma 0.007 to 0.018), so the greys read as paper under sodium light rather than as
switched-off screen.

One light section (bone ground) carries the spec table, where the manual metaphor is literal.

## Aesthetic lane

Industrial field manual. Reference objects: Carhartt WIP catalogue spreads, Snap-on tool spec
sheets, Japanese construction signage, a laminated equipment card zip-tied to a squat rack.

Explicitly not: neon-on-black fitness, purple-gradient SaaS, display-serif editorial.

**One honest caveat about the accent.** This lane was designed around signal orange, which is a
workwear colour. The accent is now the app's gold, because the site should read as the same brand
family, and gold carries a premium association orange does not. So the register sits closer to a
premium equipment catalogue than to a workshop manual. The structure is unchanged and still does
the work: visible rules, numbered sections, spec-sheet grammar, near-square corners.

## Color

Strategy: **Committed**. Gold carries the page. It is not a 10% accent sprinkled on neutrals; it
fills the primary CTA, the section numerals, the rules that matter, and one full-bleed band. The
value is the app's own `#D4AF37`, so the three surfaces read as one brand; the ground stays warm
graphite rather than the app's pure black, which is what keeps this from being a copy of
fitpal.ma. Every value below is verified against WCAG 2.2 AA, not estimated.

| Token | Hex | OKLCH | Role |
|---|---|---|---|
| `--ink` | `#14120F` | `oklch(0.183 0.007 78.1)` | Deepest ground, footer, inset wells |
| `--graphite` | `#1C1A17` | `oklch(0.219 0.007 78.2)` | Page ground |
| `--raised` | `#26231F` | `oklch(0.258 0.009 75.2)` | Raised surface, spec blocks |
| `--rule-strong` | `#746C62` | `oklch(0.536 0.018 73.5)` | Every rule on the page. 3:1 on both grounds |
| `--bone` | `#F2EDE4` | `oklch(0.948 0.013 82.4)` | Primary text on dark; ground of the light section |
| `--muted` | `#A9A198` | `oklch(0.713 0.016 70.8)` | Secondary text on dark |
| `--mute-bone` | `#5E574E` | `oklch(0.461 0.017 74.2)` | Secondary text on bone |
| `--gold` | `#D4AF37` | `oklch(0.767 0.139 91.1)` | Fills, rules, numerals, and accent text at any size on any dark ground |
| `--gold-lift` | `#E3C356` | `oklch(0.822 0.132 90.6)` | The primary button's hover fill, and nothing else |
| `--gold-deep` | `#6F5A1C` | `oklch(0.476 0.083 89.7)` | Accent text on `--bone` only |

### Verified pairs

```
14.89:1  bone on graphite        body text
13.41:1  bone on raised          body text on a card
 6.81:1  muted on graphite       secondary
 6.14:1  muted on raised         secondary on a card
 8.26:1  gold on graphite        accent text
 8.89:1  gold on ink             accent text, deepest ground
 7.44:1  gold on raised          accent text on a card
 5.71:1  gold-deep on bone       accent text, light section
 8.89:1  ink on gold             button label
10.87:1  ink on gold-lift        button label, hover
 3.36:1  rule-strong on graphite boundary (3:1 target)
 3.03:1  rule-strong on raised   boundary (3:1 target)
```

**Rules that follow from the measurements.** Gold fills always take a dark label (`--ink`), never
bone: bone on gold is 1.80:1 and fails badly. There is only one rule token, `--rule-strong`,
and it clears 3:1 on both dark grounds. A decorative `--rule` at 1.40:1 used to sit beside it
and was deleted: in practice it had ended up carrying every boundary on the page, which is
exactly what it was documented never to do.

**The accent needs no lighter variant for small text, and that is the main gain over the orange
it replaced.** `--gold` is 8.26:1 on the page ground and 7.44:1 on a card, so it carries every
size on every dark ground. The orange was 4.62:1, which passed AA but left no margin at the 12px
`--t-label` size, and needed a whole extra token to rescue the eyebrow, the section numerals and
the FAQ markers. `--gold-lift` survives only as the primary button's hover fill.

**`--gold-deep` exists because gold cannot survive the light section.** Gold on bone is 1.80:1,
and the app's own darker gold `#A5821F` only reaches 3.10:1, so the bone ground needs a value far
darker than either. `#6F5A1C` lands at 5.71:1, and doubles as a fill that can take a bone label
at the same ratio. It is the only place it may be used.

**On the entrance animation and automated contrast checks.** An auditor run against the landing
page while the first-visit intro is still fading reports the hero as failing, at a different
ratio each run, because it samples partial opacity. Measured at rest with every animation
finished: eyebrow 8.26:1, display 14.89:1, lead and note 6.81:1. The legal pages, which have no
intro, audit clean. Audit with reduced motion, or after animations settle, to get a real answer.

Re-verify with `node scripts/check-site-coach-contrast.mjs` after any palette edit.

## Typography

One family, **Archivo** (Omnibus Type), variable on both weight (100 to 900) and width (62 to
125). Chosen as a physical object: the grotesk of American job-printing and equipment labels,
not the grotesk of software. It has real condensed cuts rather than an algorithmic squeeze, and
full French diacritic coverage for the FR locale.

Contrast comes from pushing both axes hard inside one family, which is stronger than a timid
display-plus-body pair. There is no second family and no monospace: mono as shorthand for
"technical" is costume. Numerals carry the technical register instead, via
`font-variant-numeric: tabular-nums` globally, echoing the app's own convention.

| Step | Size | Axes | Use |
|---|---|---|---|
| `--t-display` | `clamp(2.75rem, 8.6vw, 5.75rem)` | wght 800, wdth 68, caps | Hero. One idea, three lines |
| `--t-h2` | `clamp(2rem, 5vw, 3.25rem)` | wght 700, wdth 78 | Section heads |
| `--t-h3` | `clamp(1.25rem, 2.2vw, 1.5rem)` | wght 600, wdth 100 | Sub-heads |
| `--t-body` | `1.0625rem` (17px) | wght 400, wdth 100 | Body, matches the app's 17px base |
| `--t-small` | `0.9375rem` | wght 400 | Captions, legal |
| `--t-label` | `0.75rem` | wght 600, tracking `.09em`, caps | Spec labels, section numerals |

Line length capped at 68ch. Line-height 1.55 on body (light-on-dark needs the extra room),
0.92 on display, 1.08 on h2. Display tracking is negative (`-0.02em`); only `--t-label` gets
positive tracking, and it is the one place caps are allowed.

## Layout

Visible structure is the grammar. Rules and numbered sections are load-bearing, not decoration.

- Container `min(1200px, 100% - 2 * var(--gutter))`, gutter `clamp(20px, 5vw, 56px)`.
- Section rhythm varies on purpose: `--sp-section` is `clamp(88px, 12vw, 168px)`, but the spec
  table and the CTA band run tighter to read as a different kind of object.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160.
- Radii near-square: 0 on rules and tables, `3px` on buttons and blocks, `6px` maximum. Nothing
  is pill-shaped. **One deliberate exception: the device frame** (`--dev-radius: 30px`,
  `--dev-screen-radius: 19px`). It is an exception because it DEPICTS AN OBJECT rather than
  styling a surface, and a phone with 6px corners is not a phone. Do not "fix" it back.
- Sections are numbered `01` to `06` in gold, set in `--t-label`, sitting on a full-width rule.
- Asymmetric by default, with one deliberate exception. The hero **stacks**: left-aligned copy
  on a text measure, then the film beneath it at the container's full width. It was a two-column
  grid with the film in the narrow right track, which is what a portrait cut wanted; a 16:9 film
  in that track resolves to about 530px wide, and the on-screen type IS the film's script, so
  that was a film nobody could read. Stacking roughly doubles it. Everything below the hero keeps
  the asymmetry — feature rows alternate rather than sitting in an even card grid.

Cards are used once, for the spec block, because a spec sheet is genuinely tabular. Feature
content is laid out as ruled rows, not as a repeating icon-heading-text grid.

## Components

- **Primary button.** Gold fill, `--ink` label, 3px radius, no shadow, no gradient. Hover
  shifts the fill to `--gold-lift` and the label stays ink. Focus shows a 2px bone ring at 2px
  offset.
- **Secondary button.** Transparent with a 1px `--rule-strong` border, bone label. Hover fills
  with `--raised`.
- **Section head.** Gold numeral, full-width rule, then the h2 beneath. One consistent object
  repeated six times, which is a deliberate system rather than scaffolding.
- **Spec row.** Label left in `--t-label` `--muted`, value right in tabular numerals. Separated
  by a `--mute-bone` tint at 28%, not by boxes. The light section needs its own value; the
  dark-ground rule token would be invisible on bone.
- **Device frame.** Every app screen on the site sits inside a phone: a 1px `--rule-strong`
  outline, an `--ink` bezel, `--dev-radius` corners, a small speaker slot, and a screen at
  `aspect-ratio: 9 / 19.5`. That ratio is the app's own phone viewport, so the body shape is
  measured rather than invented, and the captures fill it with no cropping.

  The geometry is lifted from the house component the ten tutorial videos already use
  (`compositions/components/device-frame-stage.html`); only the skin differs. Theirs is a
  gradient bezel under a five-layer shadow. Ours is a schematic outline: no gradient, no
  shadow, no imitation hardware, because the page is a field manual and a glossy phone render
  would be the one glossy thing on it.

  **This replaces an earlier rule that said the opposite** — screenshots used to be presented
  flat, deliberately, on the grounds that evidence should not be dressed up. The device frame
  is better for showing a product people hold, but it did cost that signal, so the evidence
  claim moved somewhere explicit: every device carries a visible caption ("Capture réelle" /
  "Real capture"). Stating it beats implying it.

  Never put a device frame around anything that is not a phone screen. The moment a desktop
  capture or an OG card gets a phone body, the gesture stops meaning anything.

  **The hero film is not in one, and that is the same rule, not an exception to it.** It is a
  1920x1080 film whose frames hold phones — the device bodies are inside the picture, drawn by
  the film in the same geometry. Putting the film itself in a phone would nest a phone in a
  phone and force a landscape picture into a 9:19.5 hole, where `object-fit: cover` throws away
  most of every frame. It sits unframed and as wide as the fold allows.

## Motion

One orchestrated arrival, then quiet. Nothing loops, nothing bounces, nothing animates to fill
silence.

- Easing `--ease: cubic-bezier(0.165, 0.84, 0.44, 1)` (ease-out-quart) everywhere. No spring,
  no elastic, no bounce.
- Durations `--fast: 180ms`, `--med: 320ms`, `--slow: 520ms`.
- **Hero intro**, first visit only, armed pre-paint by an inline head script so nothing flashes
  then hides. Staggered: eyebrow 40ms, display lines 90/150/210ms, lead 300ms, actions 380ms,
  screenshot 460ms with a slightly longer travel so it arrives last and reads as depth.
- **Scroll reveal** via IntersectionObserver, 16px rise plus opacity, `--slow`. JS-gated on a
  `.js` root class so a no-JS reader sees everything.
- Only `opacity` and `transform` are animated. Never layout properties. Collapsing sections
  transition `grid-template-rows`.
- `prefers-reduced-motion: reduce` is a first-class state: the observer never arms, the intro
  class is never added, and every transition and animation is removed.

## Imagery

Real screenshots of the real app, captured through `frontend/dev/capture-boot.html`, which
freezes all animation for pixel-exact output. Every product claim on the page is attached to
one. No invented UI and no mockups of screens that do not exist.

Decorative and abstract imagery (the OG cards, any texture or diagram where nothing real
exists) is generated. The bolt mark is the one asset shared with the sibling brand, drawn as
inline SVG from `frontend/resources/icon.svg`, recolored to `--gold`.

**Photography is illustrative, and is marked as such.** Two photographs appear on the site: the
portrait beside the hero headline, and the full-bleed band between the argument and the ask.
Neither carries a name, a quote, a claimed result or a product claim: a stock portrait captioned
as a named customer would be fabricated social proof, and a photograph is the easiest place to do
that by accident. Both are licensed stock, recorded in `NOTICE.md` with source and licence.

The hero portrait exists because the copy runs to a text measure and left the right half of the
hero empty. It is the only human face above the fold, which is what keeps a field-manual layout
from reading as machinery — so it earns its place, but it stays decoration: it is not rendered
below 1040px, where it would cost a screen of scrolling ahead of the film.

Both are presented **unframed** — the band full-bleed, the hero portrait filling its column —
which is the deliberate inverse of the device treatment. Evidence sits inside a phone body with a "real capture" caption under it; atmosphere
gets the full width, no frame and a "stock photograph" caption. That contrast is how a reader
tells the two apart without being told which is which, and it is why the photograph sits in an
**unnumbered** band: `01` to `06` is a declared system, and a "07" would give a stock photograph
the same standing as the spec sheet.

A visible caption states that it is a stock photograph, in the page's own language, on **both**.
The disclosure is visible rather than hidden in the `alt` attribute, because a sighted reader
needs it as much as a screen-reader user does. On the hero portrait it is overlaid on the image
rather than set beneath it, so the figure adds no height and the film below it does not move.

**A photograph must never contain a legible app screen.** Invented UI is still forbidden when it
arrives inside a photo.
