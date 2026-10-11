"""FitPal Coach — One Spine logo kit masters.

Usage (from the repo root):
  pip install fonttools brotli uharfbuzz
  python brand/logo-kit/source/build_kit.py site-coach/fonts/archivo-latin.woff2 brand/logo-kit/master

Then re-run the logo-design skill's export_variants.py for variants/ and web/ (see ../README.md).
Writes symbol (master / small-size cut / reversed-thinned), wordmark, horizontal and stacked
lockups, in black, graphite, gold and the on-dark two-colour set.
"""
import io, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import uharfbuzz as hb

FONT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

GOLD, GRAPHITE, INK, BONE, BLACK, WHITE = "#D4AF37", "#1C1A17", "#14120F", "#F2EDE4", "#000000", "#FFFFFF"

# ------------------------------------------------------------------ symbol geometry

def n(v):
    v = round(v, 2)
    return int(v) if v == int(v) else v

def spine(S, ri, bar_t, bowl_side, bowl_h, straight, cross_len, descender):
    """f + p on one stem. Returns (path_d, bbox) in a local frame with the stem's left edge at x=0
    and the bowl top at y=0. The hook's inner arc lands exactly on the bowl's top edge, so the
    f's counter and the p's bowl share one corner instead of leaving a notch."""
    ro = ri + S
    sx, sr = 0, S
    hcx = sx + ro                       # hook centre x; centre y = bowl top (0)
    top = -ro
    bt, bb = 0, bowl_h
    br = bowl_h / 2
    bx = sr + straight                  # where the bowl's arc starts
    bowl_right = bx + br
    ct, cb = bt + bar_t, bb - bar_t     # counter top/bottom (horizontals = bar_t)
    cr = (cb - ct) / 2
    cx = bowl_right - bowl_side - cr    # counter arc start: curved side = bowl_side (heavier)
    assert cx >= sr, "counter would cut into the stem"
    bottom = bb + descender
    d = (f"M{n(sx-cross_len)} {n(bt)} H{n(sx)} V{n(0)} "
         f"A{n(ro)} {n(ro)} 0 0 1 {n(hcx)} {n(top)} V{n(top+S)} "
         f"A{n(ri)} {n(ri)} 0 0 0 {n(sr)} {n(bt)} "
         f"H{n(bx)} A{n(br)} {n(br)} 0 0 1 {n(bx)} {n(bb)} H{n(sr)} V{n(bottom)} H{n(sx)} "
         f"V{n(bt+bar_t)} H{n(sx-cross_len)} Z "
         f"M{n(sr)} {n(ct)} V{n(cb)} H{n(cx)} A{n(cr)} {n(cr)} 0 0 0 {n(cx)} {n(ct)} Z")
    bbox = (sx - cross_len, top, max(bowl_right, hcx), bottom)
    return d, bbox

MASTER = dict(S=40, ri=26, bar_t=34, bowl_side=38, bowl_h=104, straight=24, cross_len=40, descender=32)
# small-size cut: heavier stems, wider gaps and counter, so 16-32 px renders don't fill in
SMALL = dict(S=48, ri=30, bar_t=40, bowl_side=46, bowl_h=124, straight=18, cross_len=42, descender=26)
# reversed: ~4 % lighter to offset irradiation of light-on-dark
REVERSED = dict(S=38, ri=27, bar_t=32, bowl_side=36, bowl_h=104, straight=25, cross_len=40, descender=32)

def place(geom, box=256, target_h=208, optical_up=2):
    """Fit the mark into a box×box canvas: height target_h, centred, nudged up optically."""
    d, (x0, y0, x1, y1) = spine(**geom)
    s = target_h / (y1 - y0)
    w = (x1 - x0) * s
    tx = (box - w) / 2 - x0 * s
    ty = (box - target_h) / 2 - y0 * s - optical_up
    return d, s, tx, ty, (x1 - x0) * s

def symbol_body(geom, fill, **kw):
    d, s, tx, ty, _ = place(geom, **kw)
    return (f'<path fill="{fill}" fill-rule="evenodd" '
            f'transform="matrix({n(s)} 0 0 {n(s)} {n(tx)} {n(ty)})" d="{d}"/>')

# ------------------------------------------------------------------ wordmark (Archivo, kerned)

def make_font(wght):
    f = instancer.instantiateVariableFont(TTFont(FONT), {"wght": wght, "wdth": 100})
    f.flavor = None  # HarfBuzz needs plain sfnt, not woff2
    buf = io.BytesIO(); f.save(buf)
    data = buf.getvalue()
    return TTFont(io.BytesIO(data)), hb.Font(hb.Face(data))

FONTS = {w: make_font(w) for w in (400, 700)}

def text_path(txt, x, baseline, size, wght, tracking=0):
    ft, hf = FONTS[wght]
    buf = hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties()
    hb.shape(hf, buf, {"kern": True, "liga": False})
    upem = ft["head"].unitsPerEm
    s = size / upem
    gs, order = ft.getGlyphSet(), ft.getGlyphOrder()
    pen = SVGPathPen(gs, ntos=lambda v: str(n(v)))
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = order[info.codepoint]
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, baseline - pos.y_offset * s)))
        x += pos.x_advance * s + tracking
    return pen.getCommands(), x - tracking

CAP = 686 / 1000

def wordmark(x, baseline, size, c1, c2):
    """'FitPal' bold + 'Coach' regular, as on the site header."""
    d1, x1 = text_path("FitPal", x, baseline, size, 700, tracking=-0.01 * size)
    d2, x2 = text_path("Coach", x1 + 0.24 * size, baseline, size, 400, tracking=-0.005 * size)
    return f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/>', x2

# ------------------------------------------------------------------ writers

def svg(w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(w)} {n(h)}" width="{n(w)}" '
            f'height="{n(h)}" role="img" aria-labelledby="t"><title id="t">{title}</title>{body}</svg>\n')


from fontTools.svgLib.path import parse_path
import re

def measure(body):
    """True ink bbox of a body made of <path [transform=matrix(...)]> elements."""
    bp = BoundsPen(None)
    for m in re.finditer(r'<path ([^>]*?)d="([^"]+)"', body):
        t = re.search(r'matrix\(([^)]+)\)', m.group(1))
        parse_path(m.group(2), TransformPen(bp, tuple(float(v) for v in t.group(1).split())) if t else bp)
    return bp.bounds

def write(name, w, h, title, body):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(svg(w, h, title, body))

T_SYM, T_LOGO = "FitPal Coach symbol", "FitPal Coach logo"

# symbol: 256 canvas, mark 208 tall (about 9 % padding), nudged up 2 for optical centre
for suffix, geom in (("", MASTER), ("-small", SMALL)):
    # gold only for the small cut (favicon tile, dark grounds); full-size gold uses the reversed drawing
    for cname, col in (("black", BLACK), ("graphite", GRAPHITE)) + ((("gold", GOLD),) if suffix else ()):
        write(f"fitpal-coach-symbol{suffix}-{cname}.svg", 256, 256, T_SYM, symbol_body(geom, col))
for cname, col in (("white", WHITE), ("bone", BONE), ("gold", GOLD)):
    write(f"fitpal-coach-symbol-reversed-{cname}.svg", 256, 256, T_SYM, symbol_body(REVERSED, col))
# app tile: gold mark on graphite, 22 % radius, mark 62 % of tile height
write("fitpal-coach-app-icon.svg", 256, 256, T_SYM,
      f'<rect width="256" height="256" rx="56" fill="{GRAPHITE}"/>'
      + symbol_body(REVERSED, GOLD, target_h=160, optical_up=2))

# ---- lockups: cropped exactly to the ink (clear space is a usage rule, not baked-in padding)
H = 256                                          # symbol height in lockups
_, _b = spine(**MASTER)
STEM = MASTER["S"] * H / (_b[3] - _b[1])         # the system unit: one stem width
TEXT = 0.50 * H / CAP                            # cap height = half the symbol height

def symbol_at(geom, fill, ox, oy):
    d, (x0, y0, x1, y1) = spine(**geom)
    s = H / (y1 - y0)
    return (f'<path fill="{fill}" fill-rule="evenodd" transform="matrix({n(s)} 0 0 {n(s)} '
            f'{n(ox - x0*s)} {n(oy - y0*s)})" d="{d}"/>'), (x1 - x0) * s

def horizontal(sym_fill, c1, c2, geom, ox=0, oy=0):
    sym, sw = symbol_at(geom, sym_fill, ox, oy)
    base = oy + H / 2 + (CAP * TEXT) / 2         # caps centred on the symbol
    words, _ = wordmark(ox + sw + 1.25 * STEM, base, TEXT, c1, c2)
    return sym + words

def stacked(sym_fill, c1, c2, geom, ox=0, oy=0):
    base = oy + H + 1.0 * STEM + CAP * TEXT
    words, _ = wordmark(ox, base, TEXT, c1, c2)
    wx0, _, wx1, _ = measure(words)
    _, sw = symbol_at(geom, sym_fill, 0, 0)
    sym, _ = symbol_at(geom, sym_fill, (wx0 + wx1) / 2 - sw / 2, oy)
    return sym + words

def wordmark_only(c1, c2, ox=0, oy=0):
    return wordmark(ox, oy + CAP * TEXT, TEXT, c1, c2)[0]

def cropped(fn, *args, pad=0):
    """Two passes: build, measure the ink, rebuild shifted so the ink starts at pad,pad."""
    x0, y0, x1, y1 = measure(fn(*args))
    body = fn(*args, ox=pad - x0, oy=pad - y0)
    return body, int(-(-(x1 - x0 + 2 * pad) // 1)), int(-(-(y1 - y0 + 2 * pad) // 1))

SETS = {
    "black":    (BLACK, BLACK, BLACK, MASTER),
    "graphite": (GRAPHITE, GRAPHITE, GRAPHITE, MASTER),   # the on-light version
    "white":    (WHITE, WHITE, WHITE, REVERSED),
    "on-dark":  (GOLD, BONE, BONE, REVERSED),             # primary: gold mark + bone name on graphite
}
for cname, args in SETS.items():
    for kind, fn in (("horizontal", horizontal), ("stacked", stacked)):
        body, w, h = cropped(fn, *args)
        write(f"fitpal-coach-{kind}-{cname}.svg", w, h, T_LOGO, body)
for cname, col in (("black", BLACK), ("graphite", GRAPHITE), ("white", WHITE), ("bone", BONE)):
    body, w, h = cropped(wordmark_only, col, col)
    write(f"fitpal-coach-wordmark-{cname}.svg", w, h, T_LOGO, body)

# on-dark previews with the graphite ground and one clear-space unit (2 stems) of padding
for kind, fn in (("horizontal", horizontal), ("stacked", stacked)):
    pad = 2 * STEM
    body, w, h = cropped(fn, GOLD, BONE, BONE, REVERSED, pad=pad)
    write(f"fitpal-coach-{kind}-on-dark-preview.svg", w, h, T_LOGO,
          f'<rect width="{w}" height="{h}" fill="{GRAPHITE}"/>{body}')

print(f"stem unit in lockups = {STEM:.2f}; wordmark size = {TEXT:.2f}")
print("written:", len(os.listdir(OUT)), "files ->", OUT)

# favicon tile: the small-size cut in gold on graphite, mark as large as the tile allows,
# so it reads in both light and dark browser tabs (same approach as the site's old favicon)
write("fitpal-coach-favicon-tile.svg", 256, 256, T_SYM,
      f'<rect width="256" height="256" rx="48" fill="{GRAPHITE}"/>'
      + symbol_body(SMALL, GOLD, target_h=196, optical_up=2))
