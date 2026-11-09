"""Talyvor logo, drawn as vectors. One geometry; the light and dark versions differ only in colour.

Geometry is written in the pixel space of Nick's light reference image (4 Nov 2026) and mapped to
master units by M(). Every stream line is an exact cubic Bezier rendering of two smooth envelope curves.
Layers, back to front: silk bodies of the three streams, the stream lines, the light where the streams
meet, the chevron (gradient, shade, sheen, rim), then the name. The logo is still: there is no animated version.
Usage: python3 logo.py  -> writes ../out/svg/*.svg
"""
import math, os, pathlib
import numpy as np
from scipy.interpolate import CubicSpline
import wordmark as WM

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
FONT_DIR = HERE / 'fonts'

# ---- master space ---------------------------------------------------------------------------
OX, OY, K = 480.0, 250.0, 4.0                   # reference px -> master units
def M(x, y):
    return ((x - OX) * K, (y - OY) * K)
def f(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

# ---- the three streams ------------------------------------------------------------------------
X_END = 781.0                                     # lines end inside the chevron's notch
RIBBONS = {
    'top': dict(n=14, sw=1.5,
        U=[(505, 303), (530, 282), (550, 270.5), (570, 264), (590, 262), (610, 263), (630, 267), (650, 275),
           (670, 288), (690, 306), (710, 324.5), (730, 339.5), (748, 348), (764, 353), (X_END, 355.5)],
        L=[(505, 318), (530, 309.5), (550, 305.5), (575, 304), (600, 307.5), (625, 315), (650, 327), (675, 339.5),
           (700, 349.5), (725, 356), (750, 361), (766, 363.6), (X_END, 365)]),
    'mid': dict(n=12, sw=1.45,
        U=[(490, 336), (510, 331), (535, 328), (560, 327.5), (590, 331), (620, 339), (650, 350), (680, 359),
           (710, 364), (745, 366), (X_END, 366.6)],
        L=[(490, 381), (510, 386.5), (535, 391), (560, 390.5), (590, 383), (620, 377.5), (650, 374), (680, 371),
           (710, 369.3), (745, 368.3), (X_END, 368)]),
    'bot': dict(n=14, sw=1.65,
        U=[(500, 432), (530, 427.5), (560, 426.5), (590, 420), (620, 408.5), (650, 395.5), (680, 385), (710, 378.5),
           (740, 373.8), (765, 370.9), (X_END, 369.5)],
        L=[(500, 448), (515, 463), (530, 475.5), (555, 484), (575, 486.5), (595, 485), (620, 477), (650, 460.5),
           (680, 435.5), (710, 409), (740, 390.5), (762, 383), (X_END, 380.5)]),
}
# repeatable variation in each line's strength, so a stream reads as many strands, not a hatch
VARY = [1.0, 0.84, 0.95, 0.78, 1.0, 0.9, 0.82, 1.0, 0.92, 0.86, 1.0, 0.88, 0.96, 0.8]

def envelope(points):
    xs, ys = zip(*points)
    return CubicSpline(xs, ys, bc_type=('not-a-knot', (1, 0.0)))

def _knots(R):
    x0 = max(R['U'][0][0], R['L'][0][0])
    ks = sorted(set([p[0] for p in R['U']] + [p[0] for p in R['L']]))
    return [k for k in ks if k >= x0], x0

def _curve(y, dy, knots, reverse=False):
    """Exact cubic Beziers for y(x) through the knots (y is cubic between knots)."""
    ks = knots[::-1] if reverse else knots
    p = M(ks[0], y(ks[0])); d = [f'M{f(p[0])} {f(p[1])}']
    for a, b in zip(ks, ks[1:]):
        h = b - a
        c1 = M(a + h / 3, y(a) + dy(a) * h / 3); c2 = M(b - h / 3, y(b) - dy(b) * h / 3); e = M(b, y(b))
        d.append(f'C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(e[0])} {f(e[1])}')
    return d

def ribbon_paths(name, n=None, width_scale=1.0):
    """The lines of one stream: [(d, stroke width, opacity, s)], and the stream's start x."""
    R = RIBBONS[name]; n = n or R['n']
    U, L = envelope(R['U']), envelope(R['L'])
    knots, x0 = _knots(R)
    out = []
    for i in range(n):
        s = i / (n - 1) if n > 1 else 0.5
        y = lambda x, s=s: float(U(x) + s * (L(x) - U(x)))
        dy = lambda x, s=s: float(U(x, 1) + s * (L(x, 1) - U(x, 1)))
        profile = 0.72 + 0.5 * math.sin(math.pi * s) if n > 2 else 1.0      # rounder: stronger in the middle of a stream
        out.append((''.join(_curve(y, dy, knots)), R['sw'] * K * width_scale * profile, VARY[i % len(VARY)] if n > 2 else 1.0, s))
    return out, x0

def ribbon_body(name):
    """The silk under a stream: its upper edge out to the arrow and its lower edge back."""
    R = RIBBONS[name]; U, L = envelope(R['U']), envelope(R['L']); knots, _ = _knots(R)
    top = _curve(lambda x: float(U(x)), lambda x: float(U(x, 1)), knots)
    bot = _curve(lambda x: float(L(x)), lambda x: float(L(x, 1)), knots, reverse=True)
    bot[0] = 'L' + bot[0][1:]
    return ''.join(top + bot) + 'Z'

# ---- the chevron ------------------------------------------------------------------------------
CHEVRON = [  # (x, y, corner radius) in reference px, clockwise from the upper arm's top-left
    (741.0, 326.0, 6.5), (768.5, 326.0, 6.0), (816.5, 368.0, 7.5),
    (768.5, 410.0, 6.0), (741.0, 410.0, 6.5), (776.0, 368.0, 2.2)]

def rounded_polygon(pts):
    P = [np.array(M(x, y)) for x, y, _ in pts]; Rr = [r * K for _, _, r in pts]
    n = len(P); segs = []
    for i in range(n):
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        u, v = (a - b) / np.linalg.norm(a - b), (c - b) / np.linalg.norm(c - b)
        theta = math.acos(max(-1, min(1, float(np.dot(u, v)))))
        t = Rr[i] / math.tan(theta / 2)
        p1, p2 = b + u * t, b + v * t
        sweep = 1 if (u[0] * v[1] - u[1] * v[0]) < 0 else 0
        segs.append((p1, p2, Rr[i], sweep))
    d = f'M{f(segs[0][1][0])} {f(segs[0][1][1])}'
    for i in range(1, n + 1):
        p1, p2, r, sw = segs[i % n]
        d += f'L{f(p1[0])} {f(p1[1])}A{f(r)} {f(r)} 0 0 {sw} {f(p2[0])} {f(p2[1])}'
    return d + 'Z'

CHEVRON_D = rounded_polygon(CHEVRON)

# ---- the name -----------------------------------------------------------------------------------
# Figtree (SIL Open Font License, the typeface of Pocket's app) at weight 850, shaped with its own kerning,
# then redrawn: every corner softened, inner corners eased, letters set a touch tighter.
NAME = dict(font=FONT_DIR / 'Figtree-wght850.ttf', track=-0.004, soft=0.026, soft_in=0.013,
            kern={'ta': -0.006, 'yv': 0.004, 'vo': -0.004}, xh=59.0)
WORD_LEFT, BASELINE = 837.0, 399.5               # reference px: where the name's ink starts, its baseline

def _name():
    paths, upm, met = WM.build(str(NAME['font']), 'talyvor', NAME['track'], NAME['kern'], NAME['soft'], NAME['soft_in'])
    x0, y0, x1, y1 = WM.bbox(paths); s = NAME['xh'] / met['xh']
    d = WM.to_svg_d(paths, lambda x, y: M(WORD_LEFT + (x - x0) * s, BASELINE - y * s))
    return d, (x1 - x0) * s, (y1 * s, y0 * s)

WORD_D, WORD_W, WORD_V = _name()                 # path, width in reference px, (ascender, descender) in px

# ---- colour -----------------------------------------------------------------------------------
# Pocket: ink #111216, ink-2 #4A5061, ink-3 #646B7B, tangerine #FF7A1A, tangerine ink #A84100,
# dark page #0F1013, dark ink #F2F3F5, cobalt #2F5BFF, sky #39C2FF
PALETTES = {
    'light': {
        'top': [(0, '#9AA0AE', 0), (.08, '#8A90A0', .36), (.20, '#4A5061', .80), (.40, '#2A2D36', 1), (.62, '#16181D', 1), (.86, '#111216', 1), (.93, '#6E3412', 1), (1, '#FF7A1A', 1)],
        'mid': [(0, '#3B6FE8', 0), (.08, '#3E74EC', .34), (.24, '#4C8DF0', .86), (.50, '#67ABF6', 1), (.78, '#4C8DF0', 1), (1, '#3E74EC', 1)],
        'bot': [(0, '#FFC08A', 0), (.08, '#FFAA66', .42), (.24, '#FF9140', .92), (.50, '#FF8329', 1), (1, '#FF7A1A', 1)],
        'body': {'top': [(0, '#646B7B', 0), (.30, '#4A5061', .07), (.70, '#23262E', .13), (1, '#6E3412', .22)],
                 'mid': [(0, '#3B6FE8', 0), (.30, '#4C8DF0', .07), (.70, '#67ABF6', .12), (1, '#3E74EC', .18)],
                 'bot': [(0, '#FFB57A', 0), (.30, '#FF9A4A', .11), (.70, '#FF8329', .19), (1, '#FF7A1A', .28)]},
        'core': [(0, '#FF9A3D', .55), (.35, '#FF7A1A', .22), (1, '#FF7A1A', 0)], 'core_r': 40,
        'chev': [(0, '#FFA13D'), (.48, '#FF7A1A'), (1, '#EE5A0A')],
        'shade': '#B8440B', 'shade_op': .30, 'sheen_op': .42, 'rim': ('#FFFFFF', .30),
        'shadow': ('#A84100', .30), 'glow': None,
        'word': '#111216',
    },
    'dark': {
        'top': [(0, '#FFFFFF', 0), (.08, '#D7DAE2', .30), (.20, '#E6E8EE', .74), (.40, '#F6F7F9', .96), (.84, '#FFFFFF', 1), (.93, '#FFD2A6', 1), (1, '#FF9A40', 1)],
        'mid': [(0, '#3B6FE8', 0), (.08, '#3E74EC', .32), (.24, '#4C8DF0', .82), (.50, '#67ABF6', 1), (.78, '#B6DCFF', 1), (1, '#F0F8FF', 1)],
        'bot': [(0, '#A84100', 0), (.08, '#B8430A', .36), (.24, '#E2560B', .90), (.50, '#FF7A1A', 1), (.84, '#FF9A3A', 1), (1, '#FFB860', 1)],
        'body': {'top': [(0, '#FFFFFF', 0), (.30, '#E6E8EE', .06), (.70, '#FFFFFF', .12), (1, '#FFD2A6', .2)],
                 'mid': [(0, '#3B6FE8', 0), (.30, '#4C8DF0', .10), (.70, '#67ABF6', .17), (1, '#B6DCFF', .24)],
                 'bot': [(0, '#A84100', 0), (.30, '#E2560B', .13), (.70, '#FF7A1A', .22), (1, '#FFB860', .32)]},
        'core': [(0, '#FFF3E2', .95), (.18, '#FFC27A', .62), (.45, '#FF7A1A', .22), (1, '#FF7A1A', 0)], 'core_r': 52,
        'chev': [(0, '#FFB24A'), (.48, '#FF7A1A'), (1, '#FF4F0A')],
        'shade': '#C2380A', 'shade_op': .34, 'sheen_op': .46, 'rim': ('#FFD39C', .55),
        'shadow': None, 'glow': {'lines': 2.0, 'lines_op': .6, 'chev': 10, 'chev_op': .62},
        'word': '#F2F3F5',
    },
}

def _stops(stops):
    return ''.join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)

def defs(p, uid, x_starts, bodies=True):
    out = []
    for name in ('top', 'mid', 'bot'):
        x1 = M(x_starts[name], 0)[0]; x2 = M(X_END, 0)[0]
        out.append(f'<linearGradient id="{uid}-{name}" gradientUnits="userSpaceOnUse" x1="{f(x1)}" y1="0" x2="{f(x2)}" y2="0">{_stops(p[name])}</linearGradient>')
        if bodies:
            out.append(f'<linearGradient id="{uid}-b{name}" gradientUnits="userSpaceOnUse" x1="{f(x1)}" y1="0" x2="{f(x2)}" y2="0">{_stops(p["body"][name])}</linearGradient>')
    cx, cy = M(771, 368)
    out.append(f'<radialGradient id="{uid}-core" gradientUnits="userSpaceOnUse" cx="{f(cx)}" cy="{f(cy)}" r="{f(p["core_r"] * K)}">{_stops(p["core"])}</radialGradient>')
    (ax, ay), (bx, by) = M(760, 326), M(778, 410)
    out.append(f'<linearGradient id="{uid}-chev" gradientUnits="userSpaceOnUse" x1="{f(ax)}" y1="{f(ay)}" x2="{f(bx)}" y2="{f(by)}">'
               + ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in p['chev']) + '</linearGradient>')
    (sx, sy), (ex, ey) = M(0, 372), M(0, 411)
    out.append(f'<linearGradient id="{uid}-shade" gradientUnits="userSpaceOnUse" x1="0" y1="{f(sy)}" x2="0" y2="{f(ey)}"><stop offset="0" stop-color="{p["shade"]}" stop-opacity="0"/><stop offset="1" stop-color="{p["shade"]}" stop-opacity="{p["shade_op"]}"/></linearGradient>')
    (hx, hy), (kx, ky) = M(744, 327), M(786, 371)
    out.append(f'<linearGradient id="{uid}-sheen" gradientUnits="userSpaceOnUse" x1="{f(hx)}" y1="{f(hy)}" x2="{f(kx)}" y2="{f(ky)}"><stop offset="0" stop-color="#FFFFFF" stop-opacity="{p["sheen_op"]}"/><stop offset=".38" stop-color="#FFFFFF" stop-opacity="{round(p["sheen_op"] * .32, 3)}"/><stop offset=".62" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>')
    (rx1, ry1), (rx2, ry2) = M(0, 326), M(0, 372)
    out.append(f'<linearGradient id="{uid}-rimg" gradientUnits="userSpaceOnUse" x1="0" y1="{f(ry1)}" x2="0" y2="{f(ry2)}"><stop offset="0" stop-color="{p["rim"][0]}" stop-opacity="{p["rim"][1]}"/><stop offset="1" stop-color="{p["rim"][0]}" stop-opacity="0"/></linearGradient>')
    out.append(f'<clipPath id="{uid}-cc"><path d="{CHEVRON_D}"/></clipPath>')
    if p['shadow']:
        out.append(f'<filter id="{uid}-sh" x="-40%" y="-40%" width="180%" height="190%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="{f(1.6 * K)}" stdDeviation="{f(2.4 * K)}" flood-color="{p["shadow"][0]}" flood-opacity="{p["shadow"][1]}"/></filter>')
    g = p['glow']
    if g:
        out.append(f'<filter id="{uid}-gl" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="{f(g["lines"] * K)}" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 {g["lines_op"]} 0" result="bo"/><feMerge><feMergeNode in="bo"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
        out.append(f'<filter id="{uid}-gc" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="{f(g["chev"] * K / 2.4)}" result="b1"/><feGaussianBlur in="SourceGraphic" stdDeviation="{f(g["chev"] * K / 7)}" result="b2"/><feColorMatrix in="b1" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 {g["chev_op"] * .7} 0" result="o1"/><feColorMatrix in="b2" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 {g["chev_op"]} 0" result="o2"/><feMerge><feMergeNode in="o1"/><feMergeNode in="o2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    return ''.join(out)

# optical sizes: same streams and chevron, fewer and stronger lines as the logo gets smaller
DETAIL = {
    'full':  ({}, 1.0, True),                                   # 120 px wide and up
    'small': ({'top': 6, 'mid': 5, 'bot': 6}, 2.1, True),       # 48 to 120 px
    'tiny':  ({'top': 2, 'mid': 1, 'bot': 2}, 6.0, False),      # 16 to 48 px (favicons)
    'pico':  ({'top': 1, 'mid': 1, 'bot': 1}, 7.5, False),      # 16 px and below
}

def symbol_body(p, uid, detail='full'):
    """The streams and the chevron, as SVG elements (no <svg> wrapper). Returns (defs, body)."""
    counts, wscale, bodies = DETAIL[detail]
    parts, xs = [], {}
    for name in ('top', 'mid', 'bot'):
        paths, x0 = ribbon_paths(name, counts.get(name), wscale); xs[name] = x0
        lines = ''.join(f'<path d="{d}" stroke-width="{f(sw)}"{"" if op == 1 else f" stroke-opacity=\"{op}\""}/>' for d, sw, op, _ in paths)
        parts.append(f'<g fill="none" stroke="url(#{uid}-{name})" stroke-linecap="round">{lines}</g>')
    silk = ''.join(f'<path d="{ribbon_body(n)}" fill="url(#{uid}-b{n})"/>' for n in ('top', 'mid', 'bot')) if bodies else ''
    lines_group = ''.join(parts)
    if p['glow']:
        lines_group = f'<g filter="url(#{uid}-gl)">{lines_group}</g>'
    core = f'<circle cx="{f(M(771, 368)[0])}" cy="{f(M(771, 368)[1])}" r="{f(p["core_r"] * K)}" fill="url(#{uid}-core)"/>'
    rim = f'<path d="{CHEVRON_D}" fill="none" clip-path="url(#{uid}-cc)" stroke="url(#{uid}-rimg)" stroke-width="{f(1.5 * K)}"/>'
    chev = (f'<path d="{CHEVRON_D}" fill="url(#{uid}-chev)"/><path d="{CHEVRON_D}" fill="url(#{uid}-shade)"/>'
            f'<path d="{CHEVRON_D}" fill="url(#{uid}-sheen)"/>{rim}')
    if p['glow']:
        chev = f'<g filter="url(#{uid}-gc)">{chev}</g>'
    elif p['shadow']:
        chev = f'<g filter="url(#{uid}-sh)">{chev}</g>'
    return defs(p, uid, xs, bodies), silk + lines_group + core + chev

# ---- bounds -----------------------------------------------------------------------------------
SYM_BOX = (494.0, 256.0, 822.0, 492.0)          # visible symbol box in reference px
TIGHT_BOX = (594.0, 256.0, 830.0, 492.0)        # square around the chevron and where the streams meet

def box(x0, y0, x1, y1):
    a, b = M(x0, y0), M(x1, y1); return a[0], a[1], b[0] - a[0], b[1] - a[1]

def svg(viewbox, body, title, extra_defs='', bg=None):
    x, y, w, h = viewbox
    bgrect = f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x)} {f(y)} {f(w)} {f(h)}" role="img" aria-label="{title}">'
            f'<title>{title}</title><defs>{extra_defs}</defs>{bgrect}{body}</svg>\n')

def word_right():
    return WORD_LEFT + WORD_W

def lockup(theme, detail='full', bg=None):
    p = PALETTES[theme]; uid = f'tv{theme[0]}{detail[0]}'
    d, body = symbol_body(p, uid, detail)
    word = f'<path d="{WORD_D}" fill="{p["word"]}"/>'
    vb = box(SYM_BOX[0], SYM_BOX[1], word_right() + 6, SYM_BOX[3])
    return svg(vb, body + word, 'Talyvor', d, bg)

def symbol(theme, detail='full', bg=None):
    p = PALETTES[theme]; uid = f'ts{theme[0]}{detail[0]}'
    d, body = symbol_body(p, uid, detail)
    return svg(box(*SYM_BOX), body, 'Talyvor', d, bg)

def wordmark_svg(theme):
    p = PALETTES[theme]
    asc, desc = WORD_V
    x0, y0 = M(WORD_LEFT - 2, BASELINE - asc - 3); x1, y1 = M(word_right() + 2, BASELINE - desc + 3)
    return svg((x0, y0, x1 - x0, y1 - y0), f'<path d="{WORD_D}" fill="{p["word"]}"/>', 'Talyvor')

def icon(theme, detail='full', crop='full', bg=None, rx=0.0, fill=0.86, glow_bg=True, symbol_on=True):
    """Square icon. crop='full': the whole symbol fits; 'tight': streams run in from the left edge."""
    p = PALETTES[theme]; uid = f'ic{theme[0]}{detail[0]}{crop[0]}'
    d, body = symbol_body(p, uid, detail)
    bx0, by0, bx1, by1 = SYM_BOX if crop == 'full' else TIGHT_BOX
    (x0, y0), (x1, y1) = M(bx0, by0), M(bx1, by1)
    w, h = x1 - x0, y1 - y0
    side = w / fill if crop == 'full' else max(w, h) / fill
    cx = (x0 + x1) / 2; cy = M(0, 368)[1] + (6 * K if crop == 'full' else 0)
    vx, vy = cx - side / 2, cy - side / 2
    clip = f'<clipPath id="{uid}-tile"><rect x="{f(vx)}" y="{f(vy)}" width="{f(side)}" height="{f(side)}" rx="{f(rx * side)}"/></clipPath>'
    tile = ''
    if bg:
        tile = f'<rect x="{f(vx)}" y="{f(vy)}" width="{f(side)}" height="{f(side)}" rx="{f(rx * side)}" fill="{bg}"/>'
        if glow_bg and theme == 'dark':
            gx, gy = M(790, 368)
            d += (f'<radialGradient id="{uid}-bgg" gradientUnits="userSpaceOnUse" cx="{f(gx)}" cy="{f(gy)}" r="{f(side * .62)}">'
                  f'<stop offset="0" stop-color="#FF7A1A" stop-opacity=".18"/><stop offset=".55" stop-color="#FF7A1A" stop-opacity=".05"/>'
                  f'<stop offset="1" stop-color="#FF7A1A" stop-opacity="0"/></radialGradient>')
            tile += f'<rect x="{f(vx)}" y="{f(vy)}" width="{f(side)}" height="{f(side)}" rx="{f(rx * side)}" fill="url(#{uid}-bgg)"/>'
    return svg((vx, vy, side, side), f'<g clip-path="url(#{uid}-tile)">{tile}{body if symbol_on else ""}</g>', 'Talyvor', d + clip)

THEME_FILE = {'light': 'on-light', 'dark': 'on-dark'}   # file names say which background the logo sits on

def export_svgs(out):
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    files = {}
    for t, tag in THEME_FILE.items():
        files[f'talyvor-logo-{tag}.svg'] = lockup(t)
        files[f'talyvor-logo-small-{tag}.svg'] = lockup(t, 'small')
        files[f'talyvor-symbol-{tag}.svg'] = symbol(t)
        files[f'talyvor-symbol-small-{tag}.svg'] = symbol(t, 'small')
        files[f'talyvor-wordmark-{tag}.svg'] = wordmark_svg(t)
    files['talyvor-app-icon.svg'] = icon('dark', 'full', 'tight', '#111216', 0.0, 0.98)            # square; the platform rounds it
    files['talyvor-app-icon-rounded.svg'] = icon('dark', 'full', 'tight', '#111216', 0.2237, 0.98)  # for slides, docs, the web
    files['talyvor-app-icon-small.svg'] = icon('dark', 'small', 'tight', '#111216', 0.0, 0.98)
    files['talyvor-avatar.svg'] = icon('dark', 'full', 'tight', '#111216', 0.0, 0.90)
    files['favicon.svg'] = icon('dark', 'tiny', 'tight', '#111216', 0.22, 0.98)
    files['talyvor-favicon-tiny.svg'] = icon('dark', 'tiny', 'tight', '#111216', 0.22, 0.98)
    files['talyvor-favicon-pico.svg'] = icon('dark', 'pico', 'tight', '#111216', 0.22, 0.98)
    files['talyvor-favicon-small.svg'] = icon('dark', 'small', 'tight', '#111216', 0.22, 0.98)
    for name, text in files.items():
        (out / name).write_text(text)
    return files

if __name__ == '__main__':
    out = ROOT / 'out' / 'svg'
    for old in out.glob('*.svg'): old.unlink()
    files = export_svgs(out)
    print(len(files), 'svgs; name width', round(WORD_W, 1), 'px')
