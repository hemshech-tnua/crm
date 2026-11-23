// Brand artwork as inline SVG, from the one source of truth: the official logo paths in src/ui/Logo.tsx (read, never
// copied by hand) and the shape rules of src/ui/Shapes.tsx (45° stripes, stripe = gap, filled, currentColor).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { html, raw, attrs } from './html.mjs';

const LOGO_TSX = fileURLToPath(new URL('../../src/ui/Logo.tsx', import.meta.url));

function readLogo() {
  const src = readFileSync(LOGO_TSX, 'utf8');
  const take = (name) => {
    const m = src.match(new RegExp(`const ${name}: readonly P\\[\\] = \\[([\\s\\S]*?)\\n\\];`));
    if (!m) throw new Error(`brand: could not read ${name} from src/ui/Logo.tsx`);
    return [...m[1].matchAll(/\['(nonzero|evenodd)', '([^']+)'\]/g)].map((x) => ({ rule: x[1], d: x[2] }));
  };
  return { SYMBOL: take('SYMBOL'), TITLE: take('TITLE'), TAGLINE: take('TAGLINE') };
}

const P = readLogo();
const VARIANTS = {
  symbol: { viewBox: '859.8 399.0 229.2 281.3', ratio: 0.8151, parts: [P.SYMBOL] },
  lockup: { viewBox: '513.4 399.0 575.6 281.3', ratio: 2.0464, parts: [P.SYMBOL, P.TITLE] },
};

/**
 * The official mark ('symbol') or mark + typeset name ('lockup'). Decorative unless `label` is given.
 * Colour is currentColor (navy on beige, beige on navy). Size it with CSS (height; width follows the ratio).
 */
export function logo({ variant = 'lockup', label, className } = {}) {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`brand.logo: unknown variant ${variant}`);
  const paths = v.parts.flat().map((p) => `<path fill-rule="${p.rule}" d="${p.d}"/>`).join('');
  return html`<svg${attrs({
    viewBox: v.viewBox,
    class: className,
    fill: 'currentColor',
    role: label ? 'img' : null,
    'aria-label': label ?? null,
    'aria-hidden': label ? null : 'true',
    focusable: 'false',
    'data-ratio': v.ratio,
  })}>${raw(paths)}</svg>`;
}

const R2 = Math.SQRT2;
function band(k, w, dir, h) {
  const B = h + 1000;
  const n = (x) => Math.round(x * 100) / 100;
  return dir === 'rise'
    ? `M${n(k + B)} ${-B}L${n(k + w + B)} ${-B}L${n(k + w - h - B)} ${h + B}L${n(k - h - B)} ${h + B}Z`
    : `M${n(k - B)} ${-B}L${n(k + w - B)} ${-B}L${n(k + w + h + B)} ${h + B}L${n(k + h + B)} ${h + B}Z`;
}

/** Logical corner (ts|te|bs|be: top/bottom × inline start/end) → physical (tl|tr|bl|br) for a reading direction. */
export function physicalCorner(pos, rtl) {
  if (/^[tb][lr]$/.test(pos)) return pos;
  if (!/^[tb][se]$/.test(pos)) throw new Error(`stripes: unknown corner "${pos}" (ts|te|bs|be or tl|tr|bl|br)`);
  const startIsRight = rtl;
  return pos[0] + ((pos[1] === 's') === startIsRight ? 'r' : 'l');
}
const ALIGN = { tl: 'xMinYMin', tr: 'xMaxYMin', bl: 'xMinYMax', br: 'xMaxYMax' };

/**
 * A run of parallel 45° stripes (brand "stripe": width = gap = unit). Put it against an edge or a corner of a section,
 * never over faces or text. dir: 'fall' ("\\"), 'rise' ("/") or, with an anchor, 'cut' (the direction that cuts the
 * corner off, so it mirrors between Hebrew and English). Decorative (aria-hidden).
 * anchor: the corner the run belongs to — logical 'ts'|'te'|'bs'|'be' (needs rtl) or physical 'tl'|'tr'|'bl'|'br'.
 * The bands are then drawn into that corner and the drawing is pinned to it (preserveAspectRatio), so whatever the
 * box's shape, the stripes stay in the corner instead of floating to the middle of the box. ctx.brand.stripes() fills
 * rtl from the page and takes the anchor from a `corner--xx` class when none is given.
 */
export function stripes({ width = 400, height = 100, unit = 24, dir = 'fall', offset = 0, count, className, anchor, rtl = true } = {}) {
  const w = unit * R2;
  const step = 2 * w;
  const n = count ?? Math.ceil((width + height) / step) + 2;
  let align = 'xMidYMid';
  const c = anchor ? physicalCorner(anchor, rtl) : null;
  if (dir === 'cut') dir = c === 'tl' || c === 'br' ? 'rise' : 'fall';
  let start = dir === 'fall' ? -height + offset : offset;
  if (c) {
    align = ALIGN[c];
    // a band covers v ∈ [k, k + w], v = x + y (rise) or x − y (fall); v at the corner decides where the run starts
    const x = c[1] === 'r' ? width : 0;
    const y = c[0] === 'b' ? height : 0;
    const v = dir === 'rise' ? x + y : x - y;
    const [lo, hi] = dir === 'rise' ? [0, width + height] : [-height, width];
    if (v === lo) start = lo; //                                     the run cuts the corner, first band at the tip
    else if (v === hi) start = hi - w - (n - 1) * step; //           … from the far side
    else start = v - w / 2 - Math.floor((n - 1) / 2) * step; //      the bands run into the corner: centre the run on it
    start += offset;
  }
  const d = Array.from({ length: n }, (_, i) => band(start + i * step, w, dir, height)).join('');
  return html`<svg${attrs({ viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: `${align} slice`, class: className, 'aria-hidden': 'true', focusable: 'false' })}><path fill="currentColor" d="${d}"/></svg>`;
}

/** The chevron (two stripes meeting), pointing in the reading direction of `dir`. */
export function chevron({ dir = 'rtl', unit = 22, className } = {}) {
  const w = unit * R2;
  const h = 120;
  const pts = `${h / 2},0 ${h / 2 + w},0 ${w},${h / 2} ${h / 2 + w},${h} ${h / 2},${h} 0,${h / 2}`;
  return html`<svg${attrs({ viewBox: `0 0 ${h / 2 + w} ${h}`, class: className, 'aria-hidden': 'true', focusable: 'false', 'data-flip': dir === 'ltr' ? '' : null })}><polygon fill="currentColor" points="${pts}"/></svg>`;
}

/** The triangle bullet ◀ (▶ in English): the brand's action mark, at cap height, in the text colour. */
export function tri({ dir = 'rtl', className } = {}) {
  const pts = dir === 'rtl' ? '10,0 10,20 0,10' : '0,0 0,20 10,10';
  return html`<svg${attrs({ viewBox: '0 0 10 20', class: ['tri', className].filter(Boolean).join(' '), 'aria-hidden': 'true', focusable: 'false' })}><polygon fill="currentColor" points="${pts}"/></svg>`;
}
