"""Generate responsive AVIF/WebP variants for site-coach and right-size the video poster.

Run: python scripts/build-images.py

The -NNNw.avif / -NNNw.webp variants are derived from the originals, which stay in the repo as
the masters, so re-running only ever rewrites derived files.

The two posters are the exception: they are shrunk IN PLACE, so the 1920x1080 masters are
replaced. That is deliberate - nothing renders them at that size and carrying both a master and
a derivative inside the deploy root means shipping the master to every visitor too. Git history
is the backup; `git show <rev>:site-coach/img/promo-poster-fr.jpg` gets the original back.
Running this script twice does not degrade them further, because the resize is skipped once the
image is already at or below the target width - but re-encoding a JPEG repeatedly would, so do
not add a second in-place pass here.

Two decisions worth knowing before changing this:

* The video poster stays a JPEG, and stays a single file, when everything else here gets
  AVIF + WebP. `<video poster>` takes one URL and has no <picture> equivalent and no fallback:
  if the browser cannot decode it the visitor gets a black rectangle. That is normally a
  sub-second problem because the video paints over it - but site.js now refuses to load the
  video at all on narrow screens and on saveData, so for those visitors the poster IS the
  final image and a decode failure would be permanent. A right-sized JPEG is universal and
  still drops the file by about 60%. It is also the LCP element, so its only real job is to
  arrive fast.

* The phone screenshots are captured at 720x1560 and displayed at 360 CSS px wide. The 2x
  variant is therefore the full 720 and there is no point generating anything larger.
"""

import io
import os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(HERE, 'site-coach')

# (source, widths, formats). Widths are intrinsic pixels, not CSS pixels.
JOBS = [
    ('img/coach-hero.jpg', [400, 800, 1100], ('avif', 'webp')),
    ('img/coaches.jpg', [600, 1200, 1800], ('avif', 'webp')),
    ('img/screens/coach-today.png', [360, 720], ('avif', 'webp')),
    ('img/screens/coach-clients.png', [360, 720], ('avif', 'webp')),
    ('img/screens/client-home-fr.png', [360, 720], ('avif', 'webp')),
    ('img/screens/client-stats-fr.png', [360, 720], ('avif', 'webp')),
    ('img/screens/client-home-en.png', [360, 720], ('avif', 'webp')),
    ('img/screens/client-stats-en.png', [360, 720], ('avif', 'webp')),
]

# The poster is rewritten in place at a sane size rather than given variants. See the note above.
POSTERS = [('img/promo-poster-fr.jpg', 800), ('img/promo-poster-en.jpg', 800)]

QUALITY = {'avif': 55, 'webp': 78, 'jpeg': 82}


def variant_name(rel, w, fmt):
    stem, _ = os.path.splitext(rel)
    return '%s-%dw.%s' % (stem, w, fmt)


def build_variants():
    total_src = 0
    total_out = 0
    rows = []
    for rel, widths, formats in JOBS:
        src = os.path.join(SITE, rel)
        if not os.path.exists(src):
            print('  skip (missing) %s' % rel)
            continue
        total_src += os.path.getsize(src)
        im = Image.open(src)
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGB')
        iw = im.width

        for w in widths:
            if w > iw:
                continue  # never upscale
            h = round(im.height * w / iw)
            resized = im.resize((w, h), Image.LANCZOS)
            for fmt in formats:
                out = os.path.join(SITE, variant_name(rel, w, fmt))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                save = resized.convert('RGB') if resized.mode == 'RGBA' else resized
                opts = {'quality': QUALITY[fmt]}
                if fmt == 'webp':
                    opts['method'] = 6  # slowest/smallest; these are built once
                save.save(out, format=fmt.upper(), **opts)
                total_out += os.path.getsize(out)
                rows.append((variant_name(rel, w, fmt), os.path.getsize(out)))
        im.close()

    for name, size in rows:
        print('  %-46s %7.1f KiB' % (name, size / 1024))
    print('\n  originals %.0f KiB -> variants %.0f KiB' % (total_src / 1024, total_out / 1024))


def build_posters():
    print('\n  posters (right-sized in place, JPEG kept deliberately):')
    for rel, target in POSTERS:
        src = os.path.join(SITE, rel)
        if not os.path.exists(src):
            print('    skip (missing) %s' % rel)
            continue
        before = os.path.getsize(src)
        im = Image.open(src)
        if im.width <= target:
            # Already built. Returning here is what makes the script idempotent: re-encoding a
            # JPEG on every run would lose a little more detail each time.
            print('    %-30s already %dpx wide, left alone' % (rel, im.width))
            im.close()
            continue
        im = im.convert('RGB')
        h = round(im.height * target / im.width)
        im = im.resize((target, h), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=QUALITY['jpeg'], optimize=True, progressive=True)
        data = buf.getvalue()
        with open(src, 'wb') as f:
            f.write(data)
        print('    %-30s %7.1f KiB -> %7.1f KiB  (%dx%d)'
              % (rel, before / 1024, len(data) / 1024, im.width, im.height))
        im.close()


if __name__ == '__main__':
    build_variants()
    build_posters()
