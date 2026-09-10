# FitPal Coach — how to build with this design system

FitPal Coach is a phone-first personal-coaching app (dark, gold accent, iOS-flavoured). Every screen is
plain HTML using the class vocabulary in `styles.css` plus the React primitives on `window.FitPalCoach`.
There is no provider, no theme object and no utility-class framework: styling is **CSS classes + CSS
custom properties**, both defined in `styles.css` (which imports `_ds_bundle.css`, the app's real
stylesheet). Read that file before styling anything; read `components/general/<Name>/<Name>.prompt.md`
before using a component.

## Page setup

- The stylesheet paints the page itself: `html { background: var(--bg) }`, `body { color: var(--label) }`,
  17px system font, tabular numerals. **Dark is the default.** For light mode set `data-theme="light"`
  on `<html>`; never hand-pick light colours. Accent is `data-accent="gold"` (default) — other values:
  `lime sky orange violet pink red teal`.
- Wrap a screen in `<div id="app">` (560px column, 16px gutters, bottom padding for the tab bar). Add
  class `narrow` for a 640px reading column on desktop; use `.cols` for a two-column desktop layout.
- Large title: `<div class="hdr"><div><h1>Today</h1><div class="sub">Wednesday 10 Sep</div></div>
  <button class="iconbtn">…</button></div>`.

## Vocabulary (all in styles.css)

- **Tokens** — surfaces `--bg --bg-el --surface --surface-2 --surface-3`; text `--label --label-2
  --label-3 --label-4`; lines `--sep --hair`; accent `--acc --acc-2 --on-acc --acc-soft --acc-line`;
  system colours `--blue --green --red --orange --yellow --teal --indigo --pink --purple --grey`;
  radii `--r-sm --r --r-lg --r-xl --r-card`; motion `--ease --fast --med`. Use `var(--…)`, never hex.
- **Type** — `.t-large .t-title .t-title2 .t-head .t-body .t-callout .t-sub .t-foot .t-cap`; tone
  with `.muted .dim .small .accent`.
- **Card** — `.card` with an eyebrow `<h2>` and a hero number `.big`. Stat tiles: `.tiles > .tile`
  with `.l` (label) and `.v` (value).
- **Grouped list** — `Section` + `Row` components (`.sect .sect-t .sect-b .sect-f`, `.lrow` with
  `.lrow-i .lrow-m .lrow-t .lrow-s .lrow-v`, `.lrow.danger`).
- **Item list** — `.list > .item` with `.grow`, `.tt` (title), `.ss` (subtitle), `.chev`, `.thumb`;
  status pills `.tag` / `.tag.acc`; horizontal filters `.chips > .chip` / `.chip.on`.
- **Home pieces** — week strip `.week > .wday` (`.lbl .num .dot.plan|.ovr|.done`, `.wday.today`);
  `.today-row` with `.lbl2` and `.ttl`.
- **Buttons** — `Button` component or `.btn` + `primary|tinted|danger|ghost|plain` + `sm|xs`.
- **Controls** — `.field` / `.field.area`, `.searchf`, `.seg`, `.sw`, `.stp`, `.sld`, `.chk`; or the
  components `TextField TextArea SearchField Segmented Switch Stepper Slider Check NumberField`.
- **Tab bar** — `<nav id="tabbar">` of `<button class="on">` cells, each `<span class="tb-i">icon</span>
  <span>Label</span>`; the raised centre action is `button.start > span.cir`.
- **Sheets** — bottom sheet `.sheet` with `.grab` handle and an `<h3>` title, over `.mback`.
- **Layout helpers** — `.row`, `.row.between`, `.grid2`, `.divider`, `h4.sec`.
- **Icons** — `Icon name="…"` only (stroke SVG, `1em`); names in `ICON_NAMES`. No emoji.
- **Charts** — `LineChart`, `Heatmap`, `BodyMap` + `BodyMapLegend`, `MacroRows` / `TargetRows`.

## Idiomatic screen

```jsx
const { Section, Row, Button, Icon, LineChart } = window.FitPalCoach
<div id="app">
  <div className="hdr"><div><h1>Sara</h1><div className="sub">Client since March</div></div>
    <Button variant="tinted" size="sm" icon="clipboard">Send program</Button></div>
  <div className="tiles">
    <div className="tile"><div className="l">Adherence</div><div className="v">86%</div></div>
    <div className="tile"><div className="l">Last check-in</div><div className="v">3 d</div></div>
  </div>
  <div className="card"><h2>Body weight</h2><div className="big">70.9 <span className="muted">kg</span></div>
    <LineChart points={points} unit="kg" goal={70} /></div>
  <Section title="This week">
    <Row icon="calendar" iconTint="var(--acc)" title="Check-in" subtitle="Due Sunday" accessory="chevron" onClick={open} />
  </Section>
</div>
```
