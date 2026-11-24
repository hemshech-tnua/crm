#!/usr/bin/env python3
"""One-off helper (NOT part of the build): make the responsive variants of a photo for site/assets/photos/.

    python3 site/tools/resize-photos.py [--grade] path/to/photo.webp [more…]

For each source it writes <name>-<width>.webp at 480, 720, 960 and the largest size (the source width, at most 1440),
WebP quality 70 (method 6) after a 0.5px denoise (the grain costs bytes, not detail): a phone gets the 480/720 file, a desktop column the 960, a full-width hero the largest.
--grade first applies the site's bright, natural grade (exposure and shadows lifted per image toward one target, a 5%
warm wash toward brand beige, no duotone), so the variants come from one graded image, not from an earlier WebP.
--name <name> sets the output name (default: the source file name); a transparent source is flattened on beige.
The build (site/build.mjs) finds the variants by file name and reads their sizes from the files, so nothing else
needs updating: use ctx.img('<name>', …) in a page. Needs Pillow. The generated files are committed; CI never runs this.
"""
import glob
import math
import os
import sys

from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageStat

WIDTHS = (480, 720, 960)
MAX_WIDTH = 1440
QUALITY = 70
DENOISE = 0.5  # px Gaussian at the output size: the illustrative photos carry grain WebP spends ~25% of its bytes on
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'photos')

# The site grade: "bright and fresh" (replaced the navy/beige duotone on 24.11, owner: "תבהיר את התמונות").
#   exposure: a per-image gamma that brings the mean luminance toward TARGET, bounded so night scenes stay evening
#   shadows: a soft toe opens the lower tones and the black point lifts a little; a soft shoulder protects highlights
#   colour: natural (saturation ~0.97, a touch of contrast back) and a 5% warm wash toward brand beige in light tones
TARGET = 0.56
GAMMA_MIN, GAMMA_MAX = 0.62, 1.0
LIFT = 0.04
SAT = 0.97
CONTRAST = 1.05
WARM, WARM_MIX = (0xEB, 0xDC, 0xB9), 0.05


def _curve(gamma):
    lut = []
    for i in range(256):
        x = i / 255
        y = x ** gamma + 0.18 * x * (1 - x) ** 3
        if y > 0.75:
            y = 1 - (1 - y) ** 1.08
        y = LIFT + y * (1 - LIFT)
        lut.append(max(0, min(255, round(y * 255))))
    return lut


def grade(im):
    im = im.convert('RGB')
    mean = ImageStat.Stat(ImageOps.grayscale(im)).mean[0] / 255
    gamma = math.log(TARGET) / math.log(max(1e-3, min(0.99, mean)))
    out = im.point(_curve(max(GAMMA_MIN, min(GAMMA_MAX, gamma))) * 3)
    out = ImageEnhance.Contrast(out).enhance(CONTRAST)
    out = ImageEnhance.Color(out).enhance(SAT)
    mask = ImageOps.grayscale(out).point(lambda v: round(255 * WARM_MIX * (v / 255) ** 1.5))
    return Image.composite(Image.new('RGB', out.size, WARM), out, mask)


def variants(src, graded=False, name=None):
    name = (name or os.path.splitext(os.path.basename(src))[0]).lower()
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, WARM + (255,))
        bg.alpha_composite(im)
        im = bg
    im = im.convert('RGB')
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
    name = args[args.index('--name') + 1] if '--name' in args else None
    files = [a for i, a in enumerate(args) if a not in ('--grade', '--name') and (i == 0 or args[i - 1] != '--name')]
    if not files or (name and len(files) > 1):
        sys.exit(__doc__)
    for path in files:
        variants(path, graded, name)
