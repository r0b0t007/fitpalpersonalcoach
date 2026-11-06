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

Since CHW-342 the FitPal Coach marketing site shows three photographs, and a fourth appears inside
its app captures. All four are by **Vitaly Gariev** (<https://unsplash.com/@silverkblack>), under
**the Unsplash License** (<https://unsplash.com/license>), which permits free commercial use and
modification and does not require attribution. They are credited in the site's footer anyway,
with the line saying the people photographed are not FitPal clients or coaches. Each is
self-hosted: `_headers` allows images from the site's own origin only. Photographer and licence
were checked on each photo's Unsplash page on 2026-11-06.

**`site-coach/img/hero-lift.jpg`** — the hero, behind an ink shade.

- **Source**: Unsplash, photo **rD0poLlu57M** (`photo-1758875569256-f37c438cac65`), "a young woman
  lifts a heavy barbell while a male trainer watches" (<https://unsplash.com/photos/rD0poLlu57M>)
- **Modifications**: downloaded at 2400px and resized to 1920x1080. The page greys it 25% and
  shades it in CSS; the file itself is not graded.

**`site-coach/img/side-client.jpg`** — section 02, the client's side.

- **Source**: Unsplash, photo **ChQzCFlNJDE** (`photo-1758599878868-52cced2f8154`), a woman
  exercising on a mat at home (<https://unsplash.com/photos/ChQzCFlNJDE>)
- **Modifications**: resized to 1600x900, cropped by the page to a 300px band.

**`site-coach/img/side-coach.jpg`** — section 02, the coach's side.

- **Source**: Unsplash, photo **6ESp0qoio_I** (`photo-1758875569399-99a7d80ace43`), "trainer and
  client discussing workout plan in gym" (<https://unsplash.com/photos/6ESp0qoio_I>)
- **Modifications**: resized to 1600x900, cropped by the page to a 300px band.

**The demo coach's portrait inside `site-coach/img/screens/public-page-*.png`** — the photo the
demo account "Karim" / "Javier" uses on its public page, in the captures and in the demo film
(`fitpal-coach-videos/videos/fitpal-coach-demo-join/assets/brand/coach-photo.jpg`).

- **Source**: Unsplash, photo **V-gUIqzSXig** (`photo-1758875568932-0eefd3e60090`), "a young
  athlete stands in a gym with arms crossed" (<https://unsplash.com/photos/V-gUIqzSXig>)
- **Modifications**: cropped square by the film project; the app crops it again on the page.

The design export credited "Vitaly Gariev, Stepan et Meghan Holmes". Stepan and Meghan Holmes took
two photographs in the design's photo set that no page uses; every photograph on the site is
Vitaly Gariev's.

The CHW-318 site's two Pexels photographs (`coaches.jpg`, Pexels 4944433 by Anastasia Shuraeva;
`coach-hero.jpg`, Pexels 37963582 by Bulat843) were deleted with their files after CHW-342, as
was a portrait of the project's owner before them (removed at the owner's request; no third-party rights
were involved). Their entries are in this file's history.

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
