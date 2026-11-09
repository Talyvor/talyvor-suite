"""The Talyvor wordmark: shaped from an open-licence font, then drawn as our own outline.

Steps: instance a variable font at the chosen axes, shape 'talyvor' with HarfBuzz (kerning on),
apply tracking and pair adjustments, flatten the outlines, merge overlaps, then soften every
corner (convex corners round by `soft`, concave ones by `soft_in`, both in em) and apply any
bespoke letter changes. The result is a single filled path in the caller's coordinates.
"""
import math, pathlib, functools
import numpy as np
import pyclipper
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.basePen import BasePen
from fontTools.pens.transformPen import TransformPen

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / 'fonts-cache'
SCALE = 64.0          # clipper works in integers: 1 font unit = 64 clipper units

class FlattenPen(BasePen):
    """Turn outlines into polygons, about one point per `step` font units along curves."""
    def __init__(self, glyphSet=None, step=4.0):
        super().__init__(glyphSet); self.polys = []; self.cur = None; self.step = step
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        n = max(4, int(math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)) // int(self.step) + 1)
        for i in range(1, n + 1):
            t = i / n; u = 1 - t
            self.cur.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                             u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        n = max(4, int(math.dist(p0, p1) + math.dist(p1, p2)) // int(self.step) + 1)
        for i in range(1, n + 1):
            t = i / n; u = 1 - t
            self.cur.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    def _closePath(self):
        if self.cur and len(self.cur) > 2: self.polys.append(self.cur)
        self.cur = None
    _endPath = _closePath

@functools.lru_cache(None)
def instance(src, axes):
    """axes: tuple of (tag, value). Returns a path to a static TTF."""
    CACHE.mkdir(exist_ok=True)
    name = pathlib.Path(src).stem + '-' + '-'.join(f'{t}{v:g}' for t, v in axes) + '.ttf'
    out = CACHE / name
    if not out.exists():
        f = TTFont(src); f.flavor = None
        if 'fvar' in f:
            have = {a.axisTag for a in f['fvar'].axes}
            f = instancer.instantiateVariableFont(f, {t: v for t, v in axes if t in have})
        f.save(out)
    return str(out)

def offset(paths, delta):
    co = pyclipper.PyclipperOffset(miter_limit=2.0, arc_tolerance=0.12 * SCALE)
    co.AddPaths(paths, pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    return co.Execute(delta)

def union(paths):
    pc = pyclipper.Pyclipper(); pc.AddPaths(paths, pyclipper.PT_SUBJECT, True)
    return pc.Execute(pyclipper.CT_UNION, pyclipper.PFT_NONZERO, pyclipper.PFT_NONZERO)

def soften(paths, r_out, r_in):
    """Round convex corners by r_out and concave corners by r_in (font units)."""
    if r_out > 0:
        paths = offset(offset(paths, -r_out * SCALE), r_out * SCALE)
    if r_in > 0:
        paths = offset(offset(paths, r_in * SCALE), -r_in * SCALE)
    return paths

def glyph_polys(font_path, text, track_em=0.0, kern=None, mods=None, step=3.0):
    """Shape and flatten. Returns (list of polygons in font units with y up, advance width, upm, metrics)."""
    blob = hb.Blob.from_file_path(font_path); face = hb.Face(blob); font = hb.Font(face)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {'kern': True, 'liga': False, 'calt': False})
    tt = TTFont(font_path); gs = tt.getGlyphSet(); order = tt.getGlyphOrder(); upm = tt['head'].unitsPerEm
    polys, x = [], 0.0; kern = kern or {}; mods = mods or {}
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]; ch = text[i]
        pen = FlattenPen(gs, step)
        gs[name].draw(TransformPen(pen, (1, 0, 0, 1, x + pos.x_offset, pos.y_offset)))
        gp = pen.polys
        if ch in mods: gp = mods[ch](gp, x)
        polys += gp
        x += pos.x_advance + track_em * upm + kern.get(text[i:i + 2], 0) * upm
    os2 = tt['OS/2']
    return polys, x, upm, {'xh': os2.sxHeight, 'cap': os2.sCapHeight}

def build(font_path, text='talyvor', track_em=0.0, kern=None, soft=0.0, soft_in=0.0, mods=None):
    """Returns (merged, softened polygons in clipper units, y up), upm, metrics."""
    polys, adv, upm, met = glyph_polys(font_path, text, track_em, kern, mods)
    paths = union([[(round(px * SCALE), round(py * SCALE)) for px, py in p] for p in polys])
    paths = soften(paths, soft * upm, soft_in * upm)
    return paths, upm, met

def bbox(paths):
    a = np.concatenate([np.array(p) for p in paths]) / SCALE
    return a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()

def _rdp(pts, tol):
    """Ramer-Douglas-Peucker on an open polyline (numpy array), keeps the ends."""
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        seg = pts[b] - pts[a]; L = np.hypot(*seg)
        rel = pts[a + 1:b] - pts[a]
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / L if L > 0 else np.hypot(rel[:, 0], rel[:, 1])
        k = int(np.argmax(d))
        if d[k] > tol:
            m = a + 1 + k; keep[m] = True; stack += [(a, m), (m, b)]
    return pts[keep]

def simplify(poly, tol):
    """Closed polygon simplification with RDP, split at the two most distant points."""
    pts = np.asarray(poly, float)
    if len(pts) < 8: return pts
    i = 0; j = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    a = _rdp(pts[i:j + 1], tol); b = _rdp(np.vstack([pts[j:], pts[:1]]), tol)
    return np.vstack([a[:-1], b[:-1]])

def to_svg_d(paths, transform, tol=0.06):
    """transform(x, y) -> (X, Y) for font units with y up. Points kept within `tol` font units of the true outline."""
    out = []
    for p in paths:
        if len(p) < 3: continue
        q = simplify(np.asarray(p, float) / SCALE, tol)
        pts = [transform(px, py) for px, py in q]
        out.append('M' + 'L'.join(f'{X:.2f} {Y:.2f}' for X, Y in pts) + 'Z')
    return ''.join(out)
