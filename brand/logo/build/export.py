"""Build every file of the Talyvor logo kit from the source SVGs. Usage: python3 export.py <kit dir>"""
import json, os, subprocess, sys, re, shutil, pathlib, struct, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import logo
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
KIT = pathlib.Path(ARGS[0]).resolve() if ARGS else HERE.parent   # the kit folder
SCR = pathlib.Path(tempfile.mkdtemp(prefix='talyvor-logo-'))
RENDER = str(pathlib.Path(__file__).resolve().parent / 'render.js')
for sub in ('svg', 'png', 'motion'):             # only the generated folders are replaced (motion is no longer made)
    if (KIT / sub).exists(): shutil.rmtree(KIT / sub)
SVG = KIT / 'svg'; files = logo.export_svgs(SVG)
SCR.mkdir(parents=True, exist_ok=True)
for d in ('logo', 'symbol', 'wordmark', 'app-icon', 'favicon', 'social', 'email'):
    (KIT / 'png' / d).mkdir(parents=True, exist_ok=True)

extra = {}   # composed SVGs that are only used to make PNGs
def nest(svgtext, x, y, w, h):
    return svgtext.replace('<svg ', f'<svg x="{x}" y="{y}" width="{w}" height="{h}" ', 1)
def og(theme):
    bg = '#0F1013' if theme == 'dark' else '#FFFFFF'
    lk = logo.lockup(theme)
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', lk).group(1).split()]
    w = 1200 * 0.66; h = w * vb[3] / vb[2]
    glow = ('<radialGradient id="og-g" cx="0.43" cy="0.5" r="0.55"><stop offset="0" stop-color="#FF7A1A" stop-opacity=".13"/>'
            '<stop offset=".6" stop-color="#FF7A1A" stop-opacity=".03"/><stop offset="1" stop-color="#FF7A1A" stop-opacity="0"/></radialGradient>') if theme == 'dark' else ''
    glowrect = '<rect width="1200" height="630" fill="url(#og-g)"/>' if theme == 'dark' else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><defs>{glow}</defs><rect width="1200" height="630" fill="{bg}"/>{glowrect}'
            f'{nest(lk, (1200 - w) / 2, (630 - h) / 2, w, h)}</svg>')
extra['og-dark.svg'] = og('dark'); extra['og-light.svg'] = og('light')
extra['maskable.svg'] = logo.icon('dark', 'full', 'tight', '#111216', 0.0, 0.76)        # content inside the 80% safe circle
extra['adaptive-fg.svg'] = logo.icon('dark', 'full', 'tight', None, 0.0, 0.60)          # Android foreground, inner 66%
bgsvg = logo.icon('dark', 'full', 'tight', '#111216', 0.0, 0.98, symbol_on=False)   # background layer: tile and glow only
extra['adaptive-bg.svg'] = bgsvg
for n, t in extra.items(): (SCR / n).write_text(t)

S = lambda n: str(SVG / n); X = lambda n: str(SCR / n); P = lambda *a: str(KIT / 'png' / os.path.join(*a))
jobs = []
def job(svg, png, width, bg=None, opaque=False):
    jobs.append({'svg': svg, 'png': png, 'width': width, **({'bg': bg} if bg else {}), 'opaque': opaque})
for tag in ('on-light', 'on-dark'):
    for w in (800, 1600, 3200): job(S(f'talyvor-logo-{tag}.svg'), P('logo', f'talyvor-logo-{tag}-{w}.png'), w)
    for w in (240, 480): job(S(f'talyvor-logo-small-{tag}.svg'), P('logo', f'talyvor-logo-small-{tag}-{w}.png'), w)
    for w in (256, 512, 1024): job(S(f'talyvor-symbol-{tag}.svg'), P('symbol', f'talyvor-symbol-{tag}-{w}.png'), w)
    for w in (96, 192): job(S(f'talyvor-symbol-small-{tag}.svg'), P('symbol', f'talyvor-symbol-small-{tag}-{w}.png'), w)
    job(S(f'talyvor-wordmark-{tag}.svg'), P('wordmark', f'talyvor-wordmark-{tag}-1200.png'), 1200)
    job(S(f'talyvor-logo-small-{tag}.svg'), P('email', f'talyvor-email-logo-{tag}-400.png'), 400)
job(S('talyvor-app-icon.svg'), P('app-icon', 'app-icon-1024.png'), 1024, '#111216', True)
job(S('talyvor-app-icon.svg'), P('app-icon', 'icon-512.png'), 512, '#111216', True)
job(S('talyvor-app-icon.svg'), P('app-icon', 'icon-192.png'), 192, '#111216', True)
job(S('talyvor-app-icon.svg'), P('app-icon', 'apple-touch-icon.png'), 180, '#111216', True)
job(X('maskable.svg'), P('app-icon', 'icon-maskable-512.png'), 512, '#111216', True)
job(X('adaptive-fg.svg'), P('app-icon', 'android-adaptive-foreground-432.png'), 432)
job(X('adaptive-bg.svg'), P('app-icon', 'android-adaptive-background-432.png'), 432, '#111216', True)
job(S('talyvor-app-icon-rounded.svg'), P('app-icon', 'app-icon-rounded-512.png'), 512)
job(S('talyvor-favicon-pico.svg'), P('favicon', 'favicon-16.png'), 16)
job(S('talyvor-favicon-tiny.svg'), P('favicon', 'favicon-32.png'), 32)
job(S('talyvor-favicon-small.svg'), P('favicon', 'favicon-48.png'), 48)
job(S('talyvor-avatar.svg'), P('social', 'avatar-400.png'), 400, '#111216', True)
job(S('talyvor-avatar.svg'), P('social', 'avatar-800.png'), 800, '#111216', True)
job(X('og-dark.svg'), P('social', 'og-image-dark-1200x630.png'), 1200, '#0F1013', True)
job(X('og-light.svg'), P('social', 'og-image-light-1200x630.png'), 1200, '#FFFFFF', True)
json.dump(jobs, open(SCR / 'jobs.json', 'w'))
subprocess.run(['node', RENDER, str(SCR / 'jobs.json')], check=True)
for j in jobs:                      # app stores reject transparency in these
    if j['opaque']:
        im = Image.open(j['png']); Image.alpha_composite(Image.new('RGBA', im.size, j['bg']), im.convert('RGBA')).convert('RGB').save(j['png'], optimize=True)
# favicon.ico with a separate drawing at each size (PNG entries)
entries = [open(P('favicon', f'favicon-{s}.png'), 'rb').read() for s in (16, 32, 48)]
ico = struct.pack('<HHH', 0, 1, len(entries)); off = 6 + 16 * len(entries); body = b''
for s, data in zip((16, 32, 48), entries):
    ico += struct.pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(data), off + len(body)); body += data
(KIT / 'png' / 'favicon' / 'favicon.ico').write_bytes(ico + body)
shutil.copy(SVG / 'favicon.svg', KIT / 'png' / 'favicon' / 'favicon.svg')
print('files:', sum(1 for _ in KIT.rglob('*') if _.is_file()))
