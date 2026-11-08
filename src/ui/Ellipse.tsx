const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

// The brand ellipse (brand book, "מערך צורני"): an outline whose weight changes smoothly along its path, thin on one
// side and fuller on the other. Never a uniform stroke, never an abrupt change, never heavy. It takes currentColor.
// Drawn as two ellipses with the inner one slightly offset (even-odd fill), so the weight varies continuously.

const OUTER = { rx: 100, ry: 56 };

function ellipse(cx0: number, cy0: number, rx: number, ry: number) {
  return `M ${cx0 - rx} ${cy0} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
}

/**
 * Decorative ring. `weight` scales the line (1 = the book's standard proportion); `tilt` rotates it (degrees).
 * Stretches to its box, so give it a size with classes (e.g. `absolute -inset-1`).
 */
export function EllipseRing({ className, weight = 1, tilt = -10, stretch = true }: { className?: string; weight?: number; tilt?: number; stretch?: boolean }) {
  const t = 2.6 * weight;
  const inner = ellipse(1.6 * weight, 1.1 * weight, OUTER.rx - 2 * t, OUTER.ry - 1.6 * t);
  return (
    <svg
      viewBox="-112 -70 224 140"
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
      className={cx('pointer-events-none', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path fillRule="evenodd" fill="currentColor" transform={`rotate(${tilt})`} d={`${ellipse(0, 0, OUTER.rx, OUTER.ry)} ${inner}`} />
    </svg>
  );
}

/** The elliptical pattern (book: "פאטרן אליפטי"): concentric rings around one centre, for calm brand backgrounds. */
export function EllipsePattern({ className, rings = 4 }: { className?: string; rings?: number }) {
  return (
    <svg viewBox="-200 -200 400 400" className={cx('pointer-events-none', className)} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <g transform="rotate(-28)" fill="none" stroke="currentColor">
        {Array.from({ length: rings }, (_, i) => {
          const k = i + 1;
          return <ellipse key={i} cx={6 * k} cy={4 * k} rx={44 * k + 30} ry={30 * k + 18} strokeWidth={3 + k * 1.2} />;
        })}
      </g>
    </svg>
  );
}
