import { useId } from 'react';

// The brand's shape system (brand book "מערך צורני"): built from one unit X, the right isosceles triangle.
//  · the stripe: a band at exactly 45°, X wide, with a gap of X to the next one; it enters from an edge or a corner of
//    the format and is cut parallel to that edge;
//  · the chevron: two stripes meeting;
//  · the triangle bullet: a small right triangle at cap height, in the text colour, pointing in the reading direction.
// Rules kept here so a screen cannot break them: 45° only, stripe = gap, all stripes parallel, filled (never outlined),
// one colour (currentColor) on the ground behind it, no circles, never on faces or text (place them in corners).

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const R2 = Math.SQRT2;

type Dir = 'rise' | 'fall'; // rise = "/" , fall = "\"

/** One 45° band, `w` wide measured horizontally, crossing the line x ± y = k; long enough to leave any box. */
function band(k: number, w: number, dir: Dir, h: number) {
  const B = h + 1000;
  return dir === 'rise'
    ? `M ${k + B} ${-B} L ${k + w + B} ${-B} L ${k + w - h - B} ${h + B} L ${k - h - B} ${h + B} Z`
    : `M ${k - B} ${-B} L ${k + w - B} ${-B} L ${k + w + h + B} ${h + B} L ${k + h + B} ${h + B} Z`;
}

/**
 * Parallel 45° stripes over a box of `width`×`height` (viewBox units; the SVG slices to its CSS size).
 * `unit` is X (the stripe's width across, = the gap). `offset` shifts the run along the box; `count` limits it.
 */
export function Stripes({ width = 400, height = 100, unit = 24, dir = 'fall', offset = 0, count, className, corner }: {
  width?: number; height?: number; unit?: number; dir?: Dir; offset?: number; count?: number; className?: string;
  /** keep the stripes inside a right-isosceles triangle at this corner of the box (they "enter from the corner") */
  corner?: { at: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; size: number };
}) {
  const id = useId().replace(/:/g, '');
  const w = unit * R2; // horizontal extent of a stripe that is `unit` wide across
  const step = 2 * w;
  const span = width + height;
  const n = count ?? Math.ceil(span / step) + 2;
  const start = dir === 'fall' ? -height + offset : offset;
  const paths = Array.from({ length: n }, (_, i) => band(start + i * step, w, dir, height));
  const tri = corner && (() => {
    const s = corner.size;
    switch (corner.at) {
      case 'top-left': return `0,0 ${s},0 0,${s}`;
      case 'top-right': return `${width},0 ${width - s},0 ${width},${s}`;
      case 'bottom-left': return `0,${height} ${s},${height} 0,${height - s}`;
      case 'bottom-right': return `${width},${height} ${width - s},${height} ${width},${height - s}`;
    }
  })();
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" className={cx('pointer-events-none', className)} aria-hidden="true" focusable="false">
      {tri && <defs><clipPath id={`c${id}`}><polygon points={tri} /></clipPath></defs>}
      <g fill="currentColor" clipPath={tri ? `url(#c${id})` : undefined}>
        {paths.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  );
}

/**
 * The cover composition of the book: two wide stripes and a chevron entering from the top edge, cut by a horizontal
 * line, on the left of the format (the logo and headline sit on the right). Fills its box; colour = currentColor.
 */
export function ChevronField({ className }: { className?: string }) {
  // drawn on a 1000×560 frame (16:9-ish), after the book's cover and section pages
  const X = 120;
  return (
    <svg viewBox="0 0 1000 560" preserveAspectRatio="xMinYMid slice" className={cx('pointer-events-none', className)} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {/* the chevron's top half: a stripe falling "\" from the top edge to the cut line */}
        <polygon points={`240,0 ${240 + X * R2},0 ${240 + X * R2 + 105},105 ${240 + 105},105`} />
        {/* the long rising stripe "/" that the chevron meets */}
        <polygon points={`${640 - 0},0 ${640 + X * R2},0 ${640 + X * R2 - 560},560 ${640 - 560},560`} />
        {/* the lower stripe, starting at the cut line and falling to the left edge */}
        <polygon points={`${150},105 ${150 + X * R2},105 ${150 + X * R2 - 455},560 ${150 - 455},560`} />
      </g>
    </svg>
  );
}

/** A chevron "<" (two stripes meeting), pointing in the reading direction (left, in Hebrew). For section breaks. */
export function Chevron({ className, unit = 22 }: { className?: string; unit?: number }) {
  const w = unit * R2;
  const h = 120;
  return (
    <svg viewBox={`0 0 ${h / 2 + w} ${h}`} className={cx('pointer-events-none', className)} aria-hidden="true" focusable="false">
      <polygon fill="currentColor" points={`${h / 2},0 ${h / 2 + w},0 ${w},${h / 2} ${h / 2 + w},${h} ${h / 2},${h} 0,${h / 2}`} />
    </svg>
  );
}

/**
 * The triangle bullet ◀ : a right isosceles triangle at cap height, in the text colour, pointing the way the line reads
 * (left in Hebrew, right in English). For lists, schedules and buttons.
 */
export function Tri({ className, dir = 'rtl', size = '0.62em' }: { className?: string; dir?: 'rtl' | 'ltr'; size?: string }) {
  return (
    <svg viewBox="0 0 10 20" style={{ height: size, width: `calc(${size} / 2)` }} className={cx('inline-block shrink-0 align-[0.04em]', className)} aria-hidden="true" focusable="false">
      <polygon fill="currentColor" points={dir === 'rtl' ? '10,0 10,20 0,10' : '0,0 0,20 10,10'} />
    </svg>
  );
}
