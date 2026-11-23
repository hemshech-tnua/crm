#!/usr/bin/env python3
"""One-off helper (NOT part of the build): make the responsive variants of a photo for site/assets/photos/.

    python3 site/tools/resize-photos.py path/to/photo.webp [more…]

For each source it writes <name>-<width>.webp at 640, 1024 and 1600 px wide (never upscaling; the largest variant is
the source width when that is under 1600). The build (site/build.mjs) finds the variants by file name and reads their
sizes from the files, so nothing else needs updating: use ctx.img('<name>', …) in a page.
Needs Pillow (already on the dev machine). The generated files are committed; CI never runs this.
"""
import os
import shutil
import sys

from PIL import Image

WIDTHS = (640, 1024, 1600)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'photos')


def variants(src):
    name = os.path.splitext(os.path.basename(src))[0].lower()
    im = Image.open(src)
    im.load()
    w, h = im.size
    targets = sorted({min(t, w) for t in WIDTHS})
    os.makedirs(OUT, exist_ok=True)
    for tw in targets:
        dst = os.path.join(OUT, f'{name}-{tw}.webp')
        if tw == w and src.lower().endswith('.webp'):
            shutil.copyfile(src, dst)  # the source size: keep the original bytes, no second compression
        else:
            th = round(h * tw / w)
            im.convert('RGB').resize((tw, th), Image.LANCZOS).save(dst, 'WEBP', quality=78, method=6)
        print(f'{dst}  {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for path in sys.argv[1:]:
        variants(path)
