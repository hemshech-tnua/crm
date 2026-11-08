#!/usr/bin/env python3
"""Regenerates src/ui/Logo.tsx and public/favicon.svg from the brand book PDF (the official logo is on page 5).

Usage:  python3 scripts/extract-logo.py path/to/Alef_Brandbook.pdf [page]
Needs pdftocairo (poppler-utils). The logo is copied as vector paths, 1:1, never redrawn.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    pdf = sys.argv[1]
    page = sys.argv[2] if len(sys.argv) > 2 else '5'
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = Path(tmp) / 'page.svg'
        subprocess.run(['pdftocairo', '-svg', '-f', page, '-l', page, pdf, str(svg_path)], check=True)
        s = svg_path.read_text()

    # pdftocairo puts the page content in a masked group; the logo is its paths inside the logo area of the page
    g = s[s.find('<g id="source-6"'):]
    g = g[:g.find('</g>')]
    items = []
    for attrs, d in re.findall(r'<path ([^>]*?)d="([^"]+)"\s*/>', g):
        nums = list(map(float, re.findall(r'-?\d+\.?\d*', d)))
        xs, ys = nums[0::2], nums[1::2]
        b = (min(xs), min(ys), max(xs), max(ys))
        if b[0] >= 400 and b[2] <= 1200 and b[1] >= 380 and b[3] <= 720:
            d2 = re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.2f}'.rstrip('0').rstrip('.'), d.strip())
            items.append((re.search(r'fill-rule="([^"]+)"', attrs).group(1), re.sub(r'\s+', ' ', d2), b))
    if not items:
        sys.exit('No logo paths found: the page layout changed. Adjust the area in this script.')

    sym = [i for i in items if i[2][0] > 850]
    title = [i for i in items if i[2][0] <= 850 and i[2][3] < 590]
    tag = [i for i in items if i[2][0] <= 850 and i[2][3] >= 590]

    def box(group):
        return (min(b[0] for *_, b in group), min(b[1] for *_, b in group), max(b[2] for *_, b in group), max(b[3] for *_, b in group))

    def vb(group):
        x0, y0, x1, y1 = box(group)
        return f'{x0:.1f} {y0:.1f} {x1 - x0:.1f} {y1 - y0:.1f}', (x1 - x0) / (y1 - y0)

    def arr(group):
        return '[\n' + ',\n'.join(f"  ['{r}', '{d}']" for r, d, _ in group) + ',\n]'

    logo = (ROOT / 'src/ui/Logo.tsx').read_text()
    head, _, rest = logo.partition('const SYMBOL')
    tail = rest[rest.index('const VARIANTS'):]
    for name, group in (('symbol', sym), ('lockup', sym + title), ('full', items)):
        view, ratio = vb(group)
        tail = re.sub(rf"({name}: {{ viewBox: ')[^']*(', ratio: )[0-9.]+", rf"\g<1>{view}\g<2>{ratio:.4f}", tail)
    body = f"const SYMBOL: readonly P[] = {arr(sym)};\n\nconst TITLE: readonly P[] = {arr(title)};\n\nconst TAGLINE: readonly P[] = {arr(tag)};\n\n"
    (ROOT / 'src/ui/Logo.tsx').write_text(head + body + tail)

    x0, y0, x1, y1 = box(sym)
    w, h = x1 - x0, y1 - y0
    side = max(w, h) * 1.36
    ox, oy = x0 - (side - w) / 2, y0 - (side - h) / 2
    paths = ''.join(f'<path fill-rule="{r}" d="{d}"/>' for r, d, _ in sym)
    (ROOT / 'public/favicon.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{ox:.1f} {oy:.1f} {side:.1f} {side:.1f}">'
        f'<rect x="{ox:.1f}" y="{oy:.1f}" width="{side:.1f}" height="{side:.1f}" rx="{side * 0.22:.1f}" fill="#F5F5EE"/>'
        f'<g fill="#402223">{paths}</g></svg>\n')
    print(f'logo: {len(sym)} symbol, {len(title)} name, {len(tag)} tagline paths')


if __name__ == '__main__':
    main()
