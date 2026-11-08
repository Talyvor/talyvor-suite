"""Light and dark must share one geometry: every path, in order, identical; only colours differ."""
import re, sys, pathlib, xml.dom.minidom
SVG = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent / 'svg'
bad = 0
for kind in ('logo', 'logo-small', 'symbol', 'symbol-small', 'wordmark'):
    a = (SVG / f'talyvor-{kind}-on-light.svg').read_text(); b = (SVG / f'talyvor-{kind}-on-dark.svg').read_text()
    for t in (a, b): xml.dom.minidom.parseString(t)          # well-formed
    da = re.findall(r' d="([^"]+)"', a); db = re.findall(r' d="([^"]+)"', b)
    ua = list(dict.fromkeys(da)); ub = list(dict.fromkeys(db))
    va = re.search(r'viewBox="([^"]+)"', a).group(1); vb = re.search(r'viewBox="([^"]+)"', b).group(1)
    sa = re.findall(r'stroke-width="([^"]+)"', a); sb = re.findall(r'stroke-width="([^"]+)"', b)
    same = ua == ub and va == vb and [w for w in sa] == [w for w in sb if True][:len(sa)]
    print(f'{kind:13s} paths {len(ua):3d} vs {len(ub):3d}  same geometry: {ua == ub}  same frame: {va == vb}  same line widths: {sa == sb[:len(sa)]}')
    bad += not (ua == ub and va == vb)
for f in SVG.glob('*.svg'): xml.dom.minidom.parseString(f.read_text())
print('all svgs well-formed;', 'OK' if not bad else f'{bad} MISMATCH')
sys.exit(1 if bad else 0)
