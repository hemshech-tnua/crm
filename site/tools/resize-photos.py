#!/usr/bin/env python3
"""One-off helper (NOT part of the build): make the responsive variants of a photo for site/assets/photos/.

    python3 site/tools/resize-photos.py [--grade] path/to/photo.webp [more…]

For each source it writes <name>-<width>.webp at 480, 720, 960 and the largest size (the source width, at most 1440),
WebP quality 68 (method 6) after a 0.5px denoise (the grain costs bytes, not detail): a phone gets the 480/720 file, a desktop column the 960, a full-width hero the largest.
--grade first applies the site's navy/beige documentary grade (duotone navy → dust → beige through a soft S-curve,
18% of the original colour kept), so the variants come from one lossless graded image, not from an earlier WebP.
The build (site/build.mjs) finds the variants by file name and reads their sizes from the files, so nothing else
needs updating: use ctx.img('<name>', …) in a page. Needs Pillow. The generated files are committed; CI never runs this.
"""
import glob
import os
import sys

from PIL import Image, ImageFilter, ImageOps

WIDTHS = (480, 720, 960)
MAX_WIDTH = 1440
QUALITY = 68
DENOISE = 0.5  # px Gaussian at the output size: the illustrative photos carry grain WebP spends ~25% of its bytes on
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'photos')

NAVY, MID, BEIGE = (0x0B, 0x18, 0x22), (0x80, 0x82, 0x78), (0xF5, 0xEE, 0xDC)
KEEP = 0.18


def _lut():
    out = []
    for i in range(256):
        t = i / 255
        t = t * t * (3 - 2 * t) * 0.35 + t * 0.65  # gentle S
        a, b, u = (NAVY, MID, t / 0.5) if t < 0.5 else (MID, BEIGE, (t - 0.5) / 0.5)
        out.append(tuple(round(a[k] + (b[k] - a[k]) * u) for k in range(3)))
    return out


def grade(im):
    lut = _lut()
    g = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=0.5)
    duo = Image.merge('RGB', [g.point([c[k] for c in lut]) for k in range(3)])
    return Image.blend(duo, im, KEEP)


def variants(src, graded=False):
    name = os.path.splitext(os.path.basename(src))[0].lower()
    im = Image.open(src).convert('RGB')
    if graded:
        im = grade(im)
    w, h = im.size
    largest = min(w, MAX_WIDTH)
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, f'{name}-*.webp')):
        os.remove(old)
    for tw in sorted({min(t, largest) for t in WIDTHS} | {largest}):
        dst = os.path.join(OUT, f'{name}-{tw}.webp')
        out = im.resize((tw, round(h * tw / w)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(DENOISE))
        out.save(dst, 'WEBP', quality=QUALITY, method=6)
        print(f'{dst}  {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    args = sys.argv[1:]
    graded = '--grade' in args
    files = [a for a in args if a != '--grade']
    if not files:
        sys.exit(__doc__)
    for path in files:
        variants(path, graded)
