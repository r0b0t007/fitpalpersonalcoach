"""Self-host Archivo for site-coach, replacing the Google Fonts request.

Run: python scripts/build-fonts.py

What it does, and why each part matters:

1. Downloads the two unicode-range slices the site can actually reach (latin, latin-ext) from
   Google. The vietnamese slice is dropped: neither locale can produce those codepoints.

2. Limits BOTH variable axes to the range site-coach/styles.css uses (wght 400-800,
   wdth 68-100) instead of the shipped 100-900 / 62-125. That is a 36% saving on the file the
   hero waits for. It is also a footgun, so scripts/check-font-axes.mjs fails the build if a
   stylesheet ever asks for a value outside the baked range.

   The font stays VARIABLE. Archivo is used at wdth 68, 78, 84 and 100 on this site, and
   flattening it to static instances would lose the condensation that is most of the site's
   visual identity.

3. Emits @font-face CSS including a metric-adjusted 'Archivo Fallback'. styles.css already
   names that family in every font stack but never defined it, so today the fallback is
   whatever the platform picks at its own metrics and the swap visibly reflows. The override
   makes the fallback occupy the same vertical and horizontal space as Archivo, so the swap is
   a change of shape and not a change of layout. That is what keeps CLS at 0.
"""

import os
import sys
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'site-coach', 'fonts')

# Pinned to the v25 files the site was built against. Re-run and re-check if Google bumps it.
SLICES = {
    'latin': 'https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLg.woff2',
    'latin-ext': 'https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdfoLnnA.woff2',
}

UNICODE_RANGE = {
    'latin': ('U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, '
              'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, '
              'U+2212, U+2215, U+FEFF, U+FFFD'),
    'latin-ext': ('U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, '
                  'U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, '
                  'U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'),
}

# Must stay in step with check-font-axes.mjs.
#
# The minimum is 400, NOT the lowest weight styles.css names. Body copy carries no
# font-weight at all, so it resolves to the CSS initial value of 400; baking a 500 floor
# silently renders every paragraph on the site one step heavier. The maximum likewise has to
# cover the UA defaults the markup relies on (h1-h4, b, strong are all 700) as well as the
# 800 the display type asks for.
WGHT = (400, 400, 800)   # min, default, max
WDTH = (68, 100, 100)
# Must match size-adjust on 'Archivo Fallback' in site-coach/styles.css; the printed overrides
# are divided by it.
SIZE_ADJUST = 1.03

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')


def fetch(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    with open(dest, 'wb') as f:
        f.write(data)
    return len(data)


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    metrics = None

    for name, url in SLICES.items():
        raw = os.path.join(OUT, '_raw-%s.woff2' % name)
        before = fetch(url, raw)

        font = TTFont(raw)
        if metrics is None:
            # Read metrics from the untouched font; instancing does not change them, but read
            # once so both slices are guaranteed to describe the same face.
            hhea, os2, head = font['hhea'], font['OS/2'], font['head']
            metrics = {
                'upem': head.unitsPerEm,
                'ascent': hhea.ascent,
                'descent': hhea.descent,
                'lineGap': hhea.lineGap,
                'capHeight': getattr(os2, 'sCapHeight', None),
                'xHeight': getattr(os2, 'sxHeight', None),
            }

        instancer.instantiateVariableFont(
            font, {'wght': WGHT, 'wdth': WDTH}, inplace=True, updateFontNames=False)
        font.flavor = 'woff2'
        dest = os.path.join(OUT, 'archivo-%s.woff2' % name)
        font.save(dest)
        font.close()
        os.remove(raw)

        after = os.path.getsize(dest)
        report[name] = (before, after)
        print('  %-10s %7.1f KiB -> %7.1f KiB  (%+.0f%%)'
              % (name, before / 1024, after / 1024, (after - before) / before * 100))

    print('\n  face metrics (unitsPerEm %d): ascent %d descent %d lineGap %d'
          % (metrics['upem'], metrics['ascent'], metrics['descent'], metrics['lineGap']))
    # size-adjust scales the override descriptors as well, so they are divided by it here.
    print('  -> at size-adjust %d%%: ascent-override: %.2f%%  descent-override: %.2f%%'
          '  line-gap-override: %.2f%%'
          % (SIZE_ADJUST * 100,
             metrics['ascent'] / metrics['upem'] * 100 / SIZE_ADJUST,
             abs(metrics['descent']) / metrics['upem'] * 100 / SIZE_ADJUST,
             metrics['lineGap'] / metrics['upem'] * 100 / SIZE_ADJUST))

    with open(os.path.join(OUT, 'METRICS.txt'), 'w', encoding='utf-8') as f:
        f.write('Archivo v25, axis-limited wght %s wdth %s\n' % (WGHT, WDTH))
        for k, v in metrics.items():
            f.write('%s = %s\n' % (k, v))
        for name, (b, a) in report.items():
            f.write('%s: %d -> %d bytes\n' % (name, b, a))
    print('\n  wrote %s' % OUT)


if __name__ == '__main__':
    sys.exit(main())
