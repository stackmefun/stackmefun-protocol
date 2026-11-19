"""One-off asset prep. Reads brand/ + reference/ bytes, writes src/assets/*.
The transparent logo carries pure-black RGB under alpha=0 (33033 of 40000 sampled px),
so every resize runs in premultiplied space (Pillow 'RGBa') then un-premultiplies."""
from PIL import Image
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, 'BRAND'); R = os.path.join(ROOT, 'REFERENCE'); O = os.path.join(ROOT, 'src', 'assets')
os.makedirs(O, exist_ok=True)
src = Image.open(os.path.join(B, 'LOGO STACKME PNG...png')).convert('RGBA')
box = src.getbbox()                       # (489,568,1511,1432)
pad = 40
cx, cy = (box[0]+box[2])//2, (box[1]+box[3])//2
half = max(box[2]-box[0], box[3]-box[1])//2 + pad
sq = src.crop((cx-half, cy-half, cx+half, cy+half))
def premul_resize(im, n):
    return im.convert('RGBa').resize((n, n), Image.LANCZOS).convert('RGBA')
for n in (512, 192):
    premul_resize(sq, n).save(os.path.join(O, f'logo-{n}.png'), optimize=True)
# favicon: 32x32 pixel grid from the premultiplied downsample, two palette colours only
g = premul_resize(sq, 32).load()
FILL, LINE = (195, 121, 252), (36, 1, 49)   # sampled: most common opaque fill / outline px
def lum(c): return c[0]*.3 + c[1]*.59 + c[2]*.11
rows = []
for y in range(32):
    x = 0; runs = []
    while x < 32:
        r, gg, b, a = g[x, y]
        if a < 128: x += 1; continue
        col = 'f' if lum((r, gg, b)) > (lum(FILL)+lum(LINE))/2 else 'l'
        x0 = x
        while x < 32 and g[x, y][3] >= 128 and ('f' if lum(g[x, y][:3]) > (lum(FILL)+lum(LINE))/2 else 'l') == col: x += 1
        runs.append((x0, x-x0, col))
    rows.append(runs)
def path(col, hexv):
    d = ''.join(f'M{x0} {y}h{w}v1h-{w}z' for y, rs in enumerate(rows) for x0, w, c in rs if c == col)
    return f'<path fill="{hexv}" d="{d}"/>'
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">'
       + path('l', '#%02x%02x%02x' % LINE) + path('f', '#%02x%02x%02x' % FILL) + '</svg>')
open(os.path.join(O, 'favicon.svg'), 'w').write(svg)
# banner
cov = Image.open(os.path.join(R, 'SAMPUL STACKME JPG.jpg.jpeg')).convert('RGB').resize((1200, 400), Image.LANCZOS)
cov.save(os.path.join(O, 'banner.jpg'), quality=84, optimize=True, progressive=True)
print('ok', box, os.listdir(O))
# full-viewport background: the cover collage at its native 1500x500 (REFERENCE/SAMPUL STACKME JPG)
Image.open(os.path.join(R, 'SAMPUL STACKME JPG.jpg.jpeg')).convert('RGB').save(os.path.join(O, 'bg.jpg'), quality=86, optimize=True, progressive=True)
