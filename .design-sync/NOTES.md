# design-sync notes — FitPal Coach

- The app is not a package: no `dist/`, no `.d.ts`, no build for components. The bundle entry is
  `frontend/src/design-system.js`, a hand-kept re-export list of the presentational primitives.
  Nothing in the app imports it. Components are pinned via `componentSrcMap` because there is no
  type tree to discover them from.
- Excluded on purpose (read the Zustand store or the router, so they cannot render alone):
  TabBar, Toast, InstallCard, Modals, Media, RestTimer, TimerFlash, MuscleExplorer, CameraScan.
  The tab bar, cards, tiles, list items, week strip and sheets are CSS vocabulary in
  `src/index.css`, taught in `conventions.md`.
- Fonts: system stack only (`-apple-system … Segoe UI, Roboto`), nothing to ship.
- Converter deps live in `.ds-sync/` (gitignored). Playwright 1.62.0 matches the cached
  Chromium 1234 under `%LOCALAPPDATA%\ms-playwright`; install with
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so it does not re-download.
- npm 11 blocks postinstall scripts (`allow-scripts`); esbuild still resolved its binary.
- `[FONT_MISSING] "SF Pro Text", "SF Pro Display"`: these are Apple's system fonts, first in the
  body stack (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', …, 'Segoe UI', Roboto`). The
  OS provides them; nothing to ship. `runtimeFontPrefixes: ["SF Pro"]` records that. On
  Windows/Linux the pane renders in Segoe UI / Roboto, exactly as the app does.
- `frontend/src/lib/i18n.js`: the three `import.meta.glob` lookups are wrapped in try/catch so
  the esbuild IIFE bundle loads (Vite rewrites the literal calls; other bundlers throw). Without
  it every component that imports `t()` took the whole bundle down at load.

## Previews

- All 24 previews are authored in `.design-sync/previews/`; they import `Phone` from
  `.design-sync/preview-frame.tsx` (kept OUTSIDE `previews/` so the converter does not mistake it
  for a component preview). The card page paints a white body while the app tokens are
  dark-first, so every cell renders inside that dark frame — without it text is white on white.
- SwipeToDelete: the swipe gesture cannot be captured; the card shows rows at rest.
- Heatmap's fixture is built relative to today (the component always ends on the current week),
  so its screenshot shifts by a column each week. Not a regression.

## Known render warns

- none on the final build.

## Re-sync risks

- `frontend/src/design-system.js` is a hand-kept re-export list: a new presentational primitive
  in `src/components/` is NOT picked up until it is added there AND to `componentSrcMap` AND to
  `dtsPropsFor` (the source is JavaScript, so props contracts are hand-written in the config —
  a prop added to `ui.jsx` silently drifts until the config is updated).
- `conventions.md` names classes from `src/index.css` by hand; a rename there goes stale here.
  The validation grep lives in the session transcript, not in a script — re-run a grep of every
  named class/token against `ds-bundle/_ds_bundle.css` after any CSS refactor.
- The `import.meta.glob` try/catch in `lib/i18n.js` is what lets the bundle load; if someone
  "cleans it up" the whole bundle throws at load and every card goes blank.
- Chromium 1234 cache pins playwright 1.62.0; a different cache build needs the matching release.
- `[DTS_REACT] @types/react not found` prints on every build: the converter looks in
  `frontend/node_modules`, and the app deliberately has no TypeScript deps. Harmless here — every
  props body comes from `dtsPropsFor`, nothing is extracted from React types. Do not add
  `@types/react` to the app for this.
