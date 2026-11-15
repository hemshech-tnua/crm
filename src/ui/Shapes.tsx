
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
 * A run of parallel 45° stripes in a `width`×`height` box (viewBox units; the SVG slices to its CSS size).
 * The box's edges are the cut: every stripe is whole or cut only by the box, parallel to the format's edge, never
 * across (book p.38). Put the box against an edge or a corner of the format. `unit` is X, the stripe's width across
 * (= the gap); keep it ≥ 12 on screen, smaller reads as a hatch. `count` limits the run to whole stripes, `offset`
 * slides it along the box. All stripes of one composition share one direction.
 */
export function Stripes({ width = 400, height = 100, unit = 24, dir = 'fall', offset = 0, count, className }: {
  width?: number; height?: number; unit?: number; dir?: Dir; offset?: number; count?: number; className?: string;
}) {
  const w = unit * R2; // horizontal extent of a stripe that is `unit` wide across
  const step = 2 * w;
  const span = width + height;
  const n = count ?? Math.ceil(span / step) + 2;
  const start = dir === 'fall' ? -height + offset : offset;
  const paths = Array.from({ length: n }, (_, i) => band(start + i * step, w, dir, height));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" className={cx('pointer-events-none', className)} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {paths.map((d, i) => <path key={i} d={d} />)}
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
