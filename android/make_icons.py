#!/usr/bin/env python3
# Build a professional launcher icon set for Raa Vansh Hotel.
# Composition: deep-navy radial background + thin gold "seal" ring + the full crest (large) + soft shadow.
import os, math
from PIL import Image, ImageDraw, ImageFilter

ROOT = '/home/user/hotel-billing'
RES  = os.path.join(ROOT, 'android', 'res')
CREST = os.path.join(ROOT, 'assets', 'logo.png')

# Brand palette
NAVY_C  = (22, 56, 106)    # center of radial
NAVY_E  = (7, 26, 52)      # edge of radial
GOLD    = (217, 189, 126)  # bright seal ring
GOLD_D  = (160, 132, 70)

def radial_navy(size):
    """Deep navy with a subtle radial highlight for depth."""
    base = Image.new('RGB', (size, size), NAVY_E)
    hi = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(hi)
    cx = cy = size / 2
    R = size * 0.78
    steps = 48
    for i in range(steps, 0, -1):
        r = R * i / steps
        a = int(120 * (1 - i / steps) ** 1.6)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=a)
    hi = hi.filter(ImageFilter.GaussianBlur(size * 0.05))
    layer = Image.new('RGB', (size, size), NAVY_C)
    return Image.composite(layer, base, hi)

def load_crest():
    im = Image.open(CREST).convert('RGBA')
    # trim to the actual crest bounds
    a = im.getchannel('A')
    bbox = a.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im

def soft_shadow(size, crest_w, crest_h, cx, cy, blur, alpha):
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.ellipse([cx - crest_w/2, cy - crest_h/2, cx + crest_w/2, cy + crest_h/2],
              fill=(0, 0, 0, alpha))
    return sh.filter(ImageFilter.GaussianBlur(blur))

def compose(size, crest_scale, ring_diam_frac, ring_w, shadow=True):
    """Legacy / square icon: navy + gold ring + crest, full bleed."""
    img = radial_navy(size).convert('RGBA')
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    # gold seal ring
    if ring_diam_frac:
        rd = size * ring_diam_frac / 2
        d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], outline=GOLD + (255,), width=ring_w)
        # subtle inner darker ring for definition
        ri = rd - ring_w
        d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], outline=GOLD_D + (160,), width=max(1, ring_w // 3))
    crest = load_crest()
    cw = size * crest_scale
    ch = cw * crest.height / crest.width
    crest = crest.resize((int(cw), int(ch)), Image.LANCZOS)
    if shadow:
        img.alpha_composite(soft_shadow(size, cw * 1.02, ch * 1.06, cx, cy + ch * 0.06, size * 0.03, 150))
    img.alpha_composite(crest, (int(cx - cw / 2), int(cy - ch / 2)))
    return img

def to_circle(square):
    """Make a round icon: circular navy with gold ring + crest, transparent corners."""
    size = square.size[0]
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mask = Image.new('L', (size, size), 0)
    dm = ImageDraw.Draw(mask)
    dm.ellipse([0, 0, size, size], fill=255)
    out.paste(square, (0, 0), mask)
    return out

def main():
    crest = load_crest()
    print('crest bounds', crest.size)
    densities = {'mdpi':48, 'hdpi':72, 'xhdpi':96, 'xxhdpi':144, 'xxxhdpi':192}
    master = compose(512, crest_scale=0.60, ring_diam_frac=0.86, ring_w=10)
    master.save(os.path.join('/tmp', 'icon_master_512.png'))
    for name, px in densities.items():
        sq = master.resize((px, px), Image.LANCZOS)
        rd = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(rd, exist_ok=True)
        sq.save(os.path.join(rd, 'ic_launcher.png'))
        to_circle(sq).save(os.path.join(rd, 'ic_launcher_round.png'))
        print('legacy', name, px)

    # Adaptive icon (API 26+): 108dp canvas; keep crest within safe zone, ring near edge.
    apx = 432
    bg = radial_navy(apx).convert('RGBA')
    bg.save(os.path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_background.png'))
    for name, px in densities.items():
        rd = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(rd, exist_ok=True)
        bg.resize((int(apx * px / 192), int(apx * px / 192)), Image.LANCZOS).save(
            os.path.join(rd, 'ic_launcher_background.png'))
    # foreground: transparent, gold ring + crest (bigger, for the larger 108dp canvas)
    fg = Image.new('RGBA', (apx, apx), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)
    cx = cy = apx / 2
    rd = apx * 0.34
    d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], outline=GOLD + (255,), width=8)
    c2 = load_crest()
    cw = apx * 0.52
    ch = cw * c2.height / c2.width
    c2 = c2.resize((int(cw), int(ch)), Image.LANCZOS)
    sh = Image.new('RGBA', (apx, apx), (0,0,0,0))
    ds = ImageDraw.Draw(sh)
    ds.ellipse([cx - cw/2, cy - ch/2, cx + cw/2, cy + ch/2], fill=(0,0,0,150))
    sh = sh.filter(ImageFilter.GaussianBlur(apx * 0.03))
    fg.alpha_composite(sh)
    fg.alpha_composite(c2, (int(cx - cw/2), int(cy - ch/2)))
    for name, px in densities.items():
        rd = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(rd, exist_ok=True)
        s = int(apx * px / 192)
        fg.resize((s, s), Image.LANCZOS).save(os.path.join(rd, 'ic_launcher_foreground.png'))

    # adaptive icon XML
    anydpi = os.path.join(RES, 'mipmap-anydpi-v26')
    os.makedirs(anydpi, exist_ok=True)
    xml = ('<?xml version="1.0" encoding="utf-8"?>\n'
           '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
           '  <background android:drawable="@mipmap/ic_launcher_background"/>\n'
           '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
           '</adaptive-icon>\n')
    open(os.path.join(anydpi, 'ic_launcher.xml'), 'w').write(xml)
    open(os.path.join(anydpi, 'ic_launcher_round.xml'), 'w').write(xml)
    print('adaptive icon written')

    # preview montage for the user
    preview = Image.new('RGB', (900, 300), (245, 245, 247))
    dp = ImageDraw.Draw(preview)
    dp.text((20, 12), 'Raa Vansh Hotel - new launcher icon (as shown on a phone home screen)', fill=(60,60,70))
    show = master.resize((192,192), Image.LANCZOS)
    # simulate a circular launcher mask
    circ = Image.new('RGBA', (192,192), (0,0,0,0))
    m = Image.new('L',(192,192),0); ImageDraw.Draw(m).ellipse([0,0,192,192],fill=255)
    circ.paste(show,(0,0),m)
    preview.paste(circ, (60, 60), circ)
    preview.paste(master.resize((192,192),Image.LANCZOS).convert('RGB'), (300, 60))
    # small sizes to prove legibility
    for i, s in enumerate([96, 72, 48]):
        t = master.resize((s,s), Image.LANCZOS).convert('RGB')
        preview.paste(t, (540 + i*110, 60 + (96-s)//2))
    preview.save(os.path.join('/tmp', 'icon_preview.png'))
    print('preview written')

def pwa_icons():
    """Regenerate the PWA / web-app icons from the same master art."""
    master = compose(512, crest_scale=0.60, ring_diam_frac=0.86, ring_w=10)
    out = os.path.join(ROOT, 'assets')
    master.resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon-512.png'))
    master.resize((192, 192), Image.LANCZOS).save(os.path.join(out, 'icon-192.png'))
    # apple-touch: opaque square (iOS applies its own rounding, no transparency wanted)
    master.convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(out, 'apple-touch-icon.png'))
    master.convert('RGBA').resize((64, 64), Image.LANCZOS).save(os.path.join(out, 'favicon-64.png'))
    print('pwa icons: icon-512, icon-192, apple-touch-icon, favicon-64')

if __name__ == '__main__':
    main()
    pwa_icons()
