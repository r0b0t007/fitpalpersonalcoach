# Third-party notices

## Body diagram geometry

The muscle outlines the body maps are drawn from (`frontend/src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise data & media

openGym obtains both through
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset), which
licenses them differently. Neither is covered by this project's own license.

That dataset is itself a redistribution: the content originates from
[**ExerciseDB v1**](https://exercisedb.dev/) by **AscendAPI**. This is verifiable from openGym's
own data — the stored media filenames embed ExerciseDB's `exerciseId` (openGym's `0001` is
`0001-2gPfomN.jpg`; `2gPfomN` is ExerciseDB's id for "3/4 sit-up"), every metadata field matches,
and the instruction sentences are identical apart from stripped `Step:N ` prefixes. See
[issue #5](https://github.com/hasaneyldrm/exercises-dataset/issues/5) on that dataset.

### Metadata & instruction text

The exercise names, attributes and instructions (English in `frontend/src/lib/exercises-data.js`,
other languages in `frontend/src/instr/` — Spanish regenerated via `scripts/build-instructions.mjs`,
French rewritten from "tu" to "vous" by `scripts/french-vous.mjs` and kept by hand since)
originate from ExerciseDB v1 and reach openGym through the dataset above, which distributes them
under the MIT license reproduced below. The translations into languages other than English are
openGym's own derivative work, as are the French and Spanish exercise names in
`frontend/src/exercise-names/`, written for FitPal Coach.

```
MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Images & animations — third-party, not MIT

The exercise thumbnails (180×180) and animations are **not** covered by the MIT license above and
**not** by this project's own license. Their ownership is currently **unresolved**, and openGym
states this plainly rather than guessing:

- The upstream dataset attributes them to **© [Gym visual](https://gymvisual.com/)**, redistributed
  there with that rights holder's written permission — a permission granted to *that dataset* and
  **not transferable**.
- **ExerciseDB/AscendAPI** describes itself as "the original creator and owner" of this content and
  publishes its own [terms](https://exercisedb.io/faq), which permit self-hosting, bundling and
  commercial display, while prohibiting redistribution of the raw dataset or media as a standalone
  or competing content package.

These two claims contradict each other. A clarification has been requested from AscendAPI; this
notice will be updated once the provenance is settled.

**Until then, treat the media as third-party content licensed to neither openGym nor to you.**

**openGym does not redistribute it.** It is not in this repository, not in its history, and not in
the published container images or the Android APK. A self-hosted instance downloads it from the
upstream source by scripts/fetch-media.sh; the mobile and demo builds load it from a CDN at
runtime.

If you want to reuse the media — in openGym or anywhere else, commercially or not — **clear it with
the rights holder first**, and keep any attribution that accompanies it intact.

Brazilian Portuguese exercise instructions under
`scripts/instruction-sources/pt-BR.json` and exercise names under
`scripts/exercise-name-sources/pt-BR.json` are original translations of that
English source produced with OpenAI Codex and Anthropic Claude Code
language-model assistance. They are not copied from a separate Portuguese
dataset. Their review status and translation policy are documented alongside
the source files.

## Marketing photography

Two photographs appear on the FitPal Coach marketing site. Both are licensed stock, used
illustratively: neither carries a name, a quote or a claimed result, and neither makes a product
claim. `DESIGN.md` states that rule. Both are under **the Pexels License**, which permits free
commercial use and modification and does not require attribution — recorded here anyway, because
a file whose provenance is not written down is a file nobody can re-licence or replace later.

A third, a portrait of the project's owner used at the ask, was added and then removed at his
request. No third-party rights were ever involved and the file is gone; this note exists only so
the removal does not read as an oversight later.

**`site-coach/img/coaches.jpg`** — the full-bleed band.

- **Source**: Pexels, photo id **4944433**, by **Anastasia Shuraeva**
  (<https://www.pexels.com/photo/4944433/>)
- **Modifications**: cropped to a 1800x750 band and graded down (brightness, saturation,
  contrast, plus a warm veil) so it sits on the site's graphite ground rather than looking
  pasted in from a brighter page.

**`site-coach/img/coach-hero.jpg`** — the portrait beside the hero headline.

- **Source**: Pexels, photo id **37963582**, by **Bulat843**
  (<https://www.pexels.com/photo/37963582/>)
- **Modifications**: cropped from the 3024x4032 original to a 1100x1375 portrait and graded to
  the same ground. Exact recipe, so it can be reproduced or applied to a replacement:

  ```
  crop=1980:2475:640:620,scale=1100:1375:flags=lanczos
  eq=brightness=-0.085:saturation=0.30:contrast=1.05
  colorbalance=rs=.045:rm=.03:gm=.01:bs=-.06:bm=-.05
  vignette=angle=PI/5
  ```

  The heavy desaturation is not only for tone: at the original saturation the client's red top
  competes with `--gold`, which is the page's only accent. The vignette sinks a bright window
  behind the coach. A subject's shirt carries a small gym wordmark; it was left alone, because
  a local blur to remove it read as a smear at full resolution and is more conspicuous at the
  rendered size than the wordmark it hid.

## Barcode scanning — `@capacitor-mlkit/barcode-scanning`

The gym check-in feature — a saved membership code shown as a QR code on the phone — was removed
with the rest of the gym surfaces. Two of its three third-party packages went with it: `lean-qr`
(MIT, David Evans) rendered the code and `jsQR` (Apache-2.0, Cosmo Wolfe) decoded it in the
browser. Neither is a dependency any more, so neither needs attributing here.

The third is still installed. Nothing imports it, but removing it means regenerating the committed
Android and iOS projects, which reference it in `capacitor.build.gradle`, `capacitor.settings.gradle`
and the `Podfile`. Until that is done it is still compiled into the app, so it is still attributed.

It is [**@capacitor-mlkit/barcode-scanning**](https://github.com/capawesome-team/capacitor-mlkit)
by the Capawesome Team (Robin Genz), a Capacitor wrapper around Google's ML Kit, used under the
**Apache License 2.0**. The `7.x` line is pinned to stay on Capacitor 7. The full license text is
available at <https://www.apache.org/licenses/LICENSE-2.0> and in the package's own `LICENSE` file.
