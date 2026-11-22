import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { fmtShortDate } from '@/lib/dates';
import { num, pct, progress } from '@/lib/metrics';
import { cx } from './kit';
import { Icon } from './Icon';

/**
 * The Friday line: the identity of the dashboard. Each meeting is a station on one continuous line;
 * the stem under it is split into returning (navy) and new (navy tint) attendees; the line connects the tops.
 * Time runs right to left, like the Hebrew line. The geometry is the brand's (book pp.36, 42, 45): straight segments,
 * filled diamonds as stations ("מטרה"), no circles, outlines or dashes. The next meeting is a beige diamond with a navy
 * core, carrying its registrations.
 */
export type LineStation = { id: string; starts_at: string; attended: number; new_count: number; returning_count: number; title: string };
export type NextStation = { id: string; starts_at: string; registered: number; capacity: number | null } | null;

/** The line draws in once per browser session; later visits (and re-renders) show it in place. */
const DRAWN_KEY = 'hemshech-friday-line-drawn';
let drawnThisSession = false;
function useDrawOnce(shown: boolean): boolean {
  const [draw] = useState(() => {
    if (drawnThisSession) return false;
    try {
      if (sessionStorage.getItem(DRAWN_KEY)) return false;
    } catch { /* storage blocked: draw once per page load */ }
    return true;
  });
  useEffect(() => {
    if (!shown) return;
    drawnThisSession = true;
    try { sessionStorage.setItem(DRAWN_KEY, '1'); } catch { /* ignore */ }
  }, [shown]);
  return draw;
}

export function FridayLine({ stations, next, goal }: { stations: LineStation[]; next: NextStation; goal?: number | null }) {
  const all = [...stations];
  const n = all.length + (next ? 1 : 0);
  const draw = useDrawOnce(n > 0);
  // on a phone the line is wider than the screen: open it on the newest meetings (the left end, in RTL)
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = -el.scrollWidth;
  }, [n]);
  if (n === 0) return null;
  const step = 92;
  const padX = 40;
  const top = 34;
  const base = 196;
  const W = padX * 2 + step * Math.max(n - 1, 1);
  const H = 250;
  const max = Math.max(1, goal ?? 0, ...all.map((s) => s.attended), next ? next.registered : 0) * 1.12;
  const y = (v: number) => base - (v / max) * (base - top);
  // oldest on the right
  const x = (i: number) => W - padX - i * step;
  const pts = all.map((s, i) => ({ x: x(i), y: y(s.attended), s }));
  const nextPt = next ? { x: x(all.length), y: y(next.registered) } : null;
  const path = [...pts, ...(nextPt ? [nextPt] : [])].map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const len = W * 1.6;
  // never larger than ~1.3× its drawn size: with one to three meetings the line would otherwise stretch over the whole
  // panel (90px numbers); a short line sits in the middle at a readable size, a long one scrolls on a phone
  const maxW = Math.round(W * 1.3);
  // and never shrunk below ~80% (the dates stay readable on a phone: the strip scrolls instead)
  const minW = Math.min(Math.max(n * 62, 320, Math.round(W * 0.8)), maxW);
  const diamond = (cx: number, cy: number, r: number) => `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;

  return (
    <div>
    <div ref={scroller} className="-mx-4 overflow-x-auto px-4 [mask-image:linear-gradient(to_left,transparent,#000_28px)] sm:mx-0 sm:px-0 sm:[mask-image:none]">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full" style={{ minWidth: minW, maxWidth: maxW }} role="group"
        aria-label={`נוכחות ב־${stations.length} המפגשים האחרונים${next ? ' והנרשמים למפגש הבא' : ''}`}>
        {goal ? (
          <g>
            <line x1={padX - 20} x2={W - padX + 20} y1={y(goal)} y2={y(goal)} stroke="var(--color-control-line)" strokeWidth="1" />
            <text x={W - padX + 20} y={y(goal) - 6} fontSize="12" fill="var(--color-muted)" direction="rtl" textAnchor="start">יעד {num(goal)}</text>
          </g>
        ) : null}
        <line x1={padX - 20} x2={W - padX + 20} y1={base} y2={base} stroke="var(--color-line)" />
        {pts.map(({ x: px, y: py, s }) => {
          const ret = y(s.returning_count);
          return (
            <g key={s.id}>
              <title>{`${fmtShortDate(s.starts_at)}: הגיעו ${s.attended} (${s.new_count} חדשים, ${s.returning_count} חוזרים)`}</title>
              <line x1={px} x2={px} y1={base} y2={ret} stroke="var(--color-ink)" strokeWidth="10" strokeLinecap="butt" />
              {s.new_count > 0 && <line x1={px} x2={px} y1={ret} y2={py} stroke="var(--color-tint)" strokeWidth="10" />}
            </g>
          );
        })}
        <path d={path} fill="none" stroke="var(--color-tide)" strokeWidth="3" strokeLinecap="butt" strokeLinejoin="miter" className="friday-line-path" data-drawn={draw ? undefined : ''} style={{ ['--len' as string]: len }} />
        {pts.map(({ x: px, y: py, s }) => (
          <Link key={s.id} to={`/app/events/${s.id}?tab=summary`} aria-description={`מפגש ${fmtShortDate(s.starts_at)}: הגיעו ${s.attended}, מתוכם ${s.new_count} חדשים`}>
            <polygon points={diamond(px, py, 6)} fill="var(--color-ink)" />
            <text x={px} y={py - 14} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-ink)" style={{ fontFamily: 'var(--font-sans)' }}>{s.attended}</text>
            <text x={px} y={base + 22} textAnchor="middle" fontSize="12.5" fill="var(--color-muted)">{fmtShortDate(s.starts_at)}</text>
          </Link>
        ))}
        {next && nextPt && (
          <Link to={`/app/events/${next.id}`} aria-description={`המפגש הבא, ${fmtShortDate(next.starts_at)}: ${next.registered} נרשמו`}>
            <polygon points={diamond(nextPt.x, nextPt.y, 8)} fill="var(--color-light)" />
            <polygon points={diamond(nextPt.x, nextPt.y, 4)} fill="var(--color-ink)" />
            <text x={nextPt.x} y={nextPt.y - 17} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-ink)" style={{ fontFamily: 'var(--font-sans)' }}>{next.registered}</text>
            <text x={nextPt.x} y={base + 22} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--color-ink)">{fmtShortDate(next.starts_at)}</text>
            <text x={nextPt.x} y={base + 40} textAnchor="middle" fontSize="11.5" fill="var(--color-muted)">נרשמו</text>
          </Link>
        )}
      </svg>
    </div>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-small text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-ink" />חוזרים</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-tint" />חדשים</span>
        {next && (
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,0 16,8 8,16 0,8" fill="var(--color-light)" /><polygon points="8,4 12,8 8,12 4,8" fill="var(--color-ink)" /></svg>
            נרשמו למפגש הבא
          </span>
        )}
      </div>
    </div>
  );
}

/** A goal from the questionnaire (Q9) with its current value and a meter. */
export function GoalStat({ label, value, display, goal, goalDisplay, hint, onOpen, lowerIsBetter, className }: {
  label: string; value: number | null; display: string; goal: number; goalDisplay: string; hint?: string; onOpen?: () => void; lowerIsBetter?: boolean; className?: string;
}) {
  const p = progress(value, goal);
  const met = value != null && (lowerIsBetter ? value <= goal : value >= goal);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 min-h-[2lh] text-small leading-snug font-medium text-ink-soft">{label}</span>
        {onOpen && <Icon name="chevron" size={16} className="mt-0.5 text-faint" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num font-display text-title-sm leading-none text-ink sm:text-stat">{display}</span>
      </div>
      {/* the meter stays navy (the book has no third colour); whether the goal is met is told by the label */}
      <div className="mt-3 h-1.5 bg-ink/10" aria-hidden="true">
        <div className="h-full bg-ink" style={{ width: `${Math.min(100, (p ?? 0) * 100)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-small">
        <span className="text-muted">יעד <span className="num">{goalDisplay}</span></span>
        {value == null ? <span className="text-faint">עוד אין נתונים</span> : met ? <span className="inline-flex items-center gap-1 font-semibold text-ink"><Icon name="check" size={14} />עומד ביעד</span> : <span className="font-medium text-ink-soft">מתחת ליעד</span>}
      </div>
      {hint && <p className="mt-1.5 hidden text-micro text-muted sm:block">{hint}</p>}
    </>
  );
  const cls = cx('block w-full rounded-[var(--radius-panel)] border border-edge bg-paper p-3.5 text-right sm:p-4', className);
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cx(cls, 'transition-colors hover:border-ink/40')}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal bars, e.g. sources: total people and how many came back. */
export function SplitBars({ rows, totalLabel, partLabel }: {
  rows: { key: string; label: ReactNode; total: number; part: number; note?: ReactNode }[]; totalLabel: string; partLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div>
      <ul className="flex flex-col gap-3.5">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-body">
              <span className="font-medium">{r.label}</span>
              <span className="num shrink-0 text-small text-muted">{r.total} · {r.total ? pct(r.part / r.total) : '—'} {partLabel}</span>
            </div>
            <div className="flex h-3" aria-hidden="true">
              <div className="h-full bg-ink" style={{ width: `${(r.part / max) * 100}%` }} />
              <div className="h-full bg-tint" style={{ width: `${((r.total - r.part) / max) * 100}%` }} />
            </div>
            {r.note && <div className="mt-1 text-micro text-muted">{r.note}</div>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-5 text-small text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-ink" />{partLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-tint" />{totalLabel}</span>
      </div>
    </div>
  );
}

/** Vertical columns (e.g. per month): total with the "new" share on top. */
export function Columns({ data }: { data: { key: string; label: string; total: number; highlight: number; title?: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex h-56 items-end gap-2" style={{ minWidth: data.length * 48 }} role="img" aria-label="נוכחות לפי תקופה">
        {data.map((d) => (
          <div key={d.key} className="flex min-w-10 flex-1 flex-col items-center gap-1.5" title={d.title}>
            <span className="num text-small font-bold">{d.total}</span>
            <div className="flex w-full max-w-14 flex-col justify-end overflow-hidden" style={{ height: `${(d.total / max) * 150 + 2}px` }}>
              <div className="bg-tint" style={{ height: `${d.total ? (d.highlight / d.total) * 100 : 0}%` }} />
              <div className="flex-1 bg-ink" />
            </div>
            <span className="text-center text-micro text-muted">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
