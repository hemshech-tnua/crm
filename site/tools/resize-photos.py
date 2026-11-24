#!/usr/bin/env python3
"""One-off helper (NOT part of the build): make the responsive variants of a photo for site/assets/photos/.

    python3 site/tools/resize-photos.py [--grade | --portrait] [--name <name>] path/to/photo.png [more…]

For each source it writes <name>-<width>.webp at 480, 720, 960 and the largest size (the source width, at most 1440),
WebP quality 72 (method 6) after a light sharpen at the output size (graded sources are denoised first): a phone gets the 480/720 file, a desktop column
the 960, a full-width hero the largest.
--grade first applies the site's bright, vivid grade (see GRADE below), so the variants come from one graded image,
not from an earlier WebP. Run every illustrative photo through it, from its original, so the set stays consistent.
--portrait applies the gentle portrait grade instead (a little brighter and clearer; skin colour left natural).
--name <name> sets the output name (default: the source file name); a transparent source is flattened on beige.
The build (site/build.mjs) finds the variants by file name and reads their sizes from the files, so nothing else
needs updating: use ctx.img('<name>', …) in a page. Needs Pillow. The generated files are committed; CI never runs this.

Reproduce the current set (originals: the 1792×2240 / 1600×905 PNG/WebP masters and the founders' portraits from
hemshechtnua.org.il /images/ariel.png and /images/elazar.png):
    resize-photos.py --grade training.png walk.png hills.webp
    resize-photos.py --portrait --name team-ariel ariel.png
    resize-photos.py --portrait --name team-elazar elazar.png
    resize-photos.py --name highfive team-highfive.png    # these three came already graded: no --grade
    resize-photos.py --name coffee coffee-after.png
    resize-photos.py --name welcome welcome-at-door.png
"""
import glob
import math
import os
import sys

from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageStat

WIDTHS = (480, 720, 960)
MAX_WIDTH = 1440
QUALITY = 72
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'photos')
BEIGE = (0xEB, 0xDC, 0xB9)

# GRADE — "bright and vivid" (25.11, owner: "תבהיר את התמונות ותדגיש צבעים").
#   exposure: a per-image gamma that brings the mean luminance toward TARGET (bounded, so a sunset stays a sunset)
#   shadows/midtones: a toe that opens the lower tones (SHADOWS), a midtone bump (MIDS), the black point lifted by LIFT;
#                     a soft shoulder keeps highlights from clipping
#   colour: saturation ×SAT for every pixel, plus VIBRANCE more for the muted ones (grass, sky, foliage gain the most,
#           already-strong colours and skin the least); HUES adds a little more to foliage greens and sky blues
#           ((centre, half-width, extra) on Pillow's 0–255 hue scale: green ≈ 80, blue ≈ 150; skin tones are left out);
#           CONTRAST puts back the snap the lift takes out
#   crisp: DENOISE (px Gaussian on the master: the grain costs bytes, not detail), then an unsharp mask at each output
#          size (SHARPEN = radius, percent, threshold; the threshold leaves the grain alone) — crisper than before at
#          about the same file size
# 26.11, owner: "התמונות עדיין לא צבעוניות, הן אפורות ומשעממות" — no black-point lift (it greyed the image), more contrast,
# much stronger saturation and vibrance, greens and blues pushed further.
GRADE = dict(TARGET=0.58, GAMMA_MIN=0.55, GAMMA_MAX=1.0, SHADOWS=0.10, MIDS=0.02, LIFT=0.0,
             SAT=1.65, VIBRANCE=0.65, CONTRAST=1.24, HUES=((80, 32, 0.35), (150, 24, 0.35)), DENOISE=0.8)
# PORTRAIT — faces stay natural: a little exposure and shadow lift, a touch of local contrast (clarity), no colour push.
PORTRAIT = dict(TARGET=0.64, GAMMA_MIN=0.80, GAMMA_MAX=1.0, SHADOWS=0.14, MIDS=0.03, LIFT=0.015,
                SAT=1.04, VIBRANCE=0.0, CONTRAST=1.0, CLARITY=(24, 14, 2), DENOISE=0.4)
SHARPEN = (1.0, 60, 4)        # 960 and up
SHARPEN_SMALL = (0.8, 45, 6)  # 480/720: already crisp from the downscale; a lighter mask keeps the phone files light


def _curve(gamma, g):
    lut = []
    for i in range(256):
        x = i / 255
        y = x ** gamma + g['SHADOWS'] * x * (1 - x) ** 3 + g['MIDS'] * math.sin(math.pi * x) ** 2
        if y > 0.8:  # soft shoulder: compress what would clip
            y = 0.8 + 0.2 * (1 - math.exp(-(y - 0.8) / 0.2)) / (1 - math.exp(-1))
        y = g['LIFT'] + min(1.0, y) * (1 - g['LIFT'])
        lut.append(max(0, min(255, round(y * 255))))
    return lut


def grade(im, g=GRADE):
    im = im.convert('RGB')
    mean = ImageStat.Stat(ImageOps.grayscale(im)).mean[0] / 255
    gamma = math.log(g['TARGET']) / math.log(max(1e-3, min(0.99, mean)))
    out = im.point(_curve(max(g['GAMMA_MIN'], min(g['GAMMA_MAX'], gamma)), g) * 3)
    out = ImageEnhance.Contrast(out).enhance(g['CONTRAST'])
    base = ImageEnhance.Color(out).enhance(g['SAT'])
    if g['VIBRANCE']:
        # vibrance: blend toward a stronger saturation where the pixel is still muted (low HSV saturation)
        strong = ImageEnhance.Color(out).enhance(g['SAT'] + g['VIBRANCE'])
        muted = ImageOps.invert(base.convert('HSV').getchannel('S')).point(lambda v: round(v * 0.85))
        base = Image.composite(strong, base, muted)
    for centre, half, extra in g.get('HUES', ()):
        # a soft hue window (cosine falloff) → that hue range is blended toward a stronger saturation
        win = [round(255 * 0.5 * (1 + math.cos(math.pi * min(1.0, abs(h - centre) / half)))) for h in range(256)]
        mask = base.convert('HSV').getchannel('H').point(win)
        base = Image.composite(ImageEnhance.Color(base).enhance(1 + extra), base, mask)
    if 'CLARITY' in g:
        r, p, t = g['CLARITY']
        base = base.filter(ImageFilter.UnsharpMask(r, p, t))
    return base.filter(ImageFilter.GaussianBlur(g['DENOISE']))


def variants(src, mode=None, name=None):
    name = (name or os.path.splitext(os.path.basename(src))[0]).lower()
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, BEIGE + (255,))
        bg.alpha_composite(im)
        im = bg
    im = im.convert('RGB')
    if mode == 'grade':
        im = grade(im, GRADE)
    elif mode == 'portrait':
        im = grade(im, PORTRAIT)
    w, h = im.size
    largest = min(w, MAX_WIDTH)
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, f'{name}-*.webp')):
        os.remove(old)
    for tw in sorted({min(t, largest) for t in WIDTHS} | {largest}):
        dst = os.path.join(OUT, f'{name}-{tw}.webp')
        out = im.resize((tw, round(h * tw / w)), Image.LANCZOS).filter(ImageFilter.UnsharpMask(*(SHARPEN if tw >= 960 else SHARPEN_SMALL)))
        out.save(dst, 'WEBP', quality=QUALITY, method=6)
        print(f'{dst}  {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    args = sys.argv[1:]
    mode = 'portrait' if '--portrait' in args else 'grade' if '--grade' in args else None
    name = args[args.index('--name') + 1] if '--name' in args else None
    files = [a for i, a in enumerate(args) if a not in ('--grade', '--portrait', '--name') and (i == 0 or args[i - 1] != '--name')]
    if not files or (name and len(files) > 1):
        sys.exit(__doc__)
    for path in files:
        variants(path, mode, name)
