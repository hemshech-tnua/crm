import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { fmtShortDate } from '@/lib/dates';
import { num, pct, progress } from '@/lib/metrics';
import { cx } from './kit';
import { Icon } from './Icon';

/**
 * The Friday line: the identity of the dashboard. Each meeting is a station on one continuous line;
 * the stem under it is split into returning (ink) and new (saffron) attendees; the line connects the tops.
 * Time runs right to left, like the Hebrew line. The next meeting is an open ring with its registrations.
 */
export type LineStation = { id: string; starts_at: string; attended: number; new_count: number; returning_count: number; title: string };
export type NextStation = { id: string; starts_at: string; registered: number; capacity: number | null } | null;

export function FridayLine({ stations, next, goal }: { stations: LineStation[]; next: NextStation; goal?: number | null }) {
  const all = [...stations];
  const n = all.length + (next ? 1 : 0);
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
  const path = [...pts, ...(nextPt ? [nextPt] : [])]
    .map((p, i, arr) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = arr[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
    })
    .join(' ');
  const len = W * 1.6;

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ minWidth: Math.max(n * 62, 320) }} role="group"
        aria-label={`נוכחות ב-${stations.length} המפגשים האחרונים${next ? ' והנרשמים למפגש הבא' : ''}`}>
        {goal ? (
          <g>
            <line x1={padX - 20} x2={W - padX + 20} y1={y(goal)} y2={y(goal)} stroke="var(--color-faint)" strokeDasharray="4 6" />
            <text x={padX - 22} y={y(goal) - 6} fontSize="12" fill="var(--color-muted)" textAnchor="start">יעד {num(goal)}</text>
          </g>
        ) : null}
        <line x1={padX - 20} x2={W - padX + 20} y1={base} y2={base} stroke="var(--color-line)" />
        {pts.map(({ x: px, y: py, s }) => {
          const ret = y(s.returning_count);
          return (
            <g key={s.id}>
              <title>{`${fmtShortDate(s.starts_at)}: הגיעו ${s.attended} (${s.new_count} חדשים, ${s.returning_count} חוזרים)`}</title>
              <line x1={px} x2={px} y1={base} y2={ret} stroke="var(--color-ink)" strokeWidth="10" strokeLinecap="butt" opacity="0.85" />
              {s.new_count > 0 && <line x1={px} x2={px} y1={ret} y2={py} stroke="var(--color-light)" strokeWidth="10" />}
            </g>
          );
        })}
        <path d={path} fill="none" stroke="var(--color-tide)" strokeWidth="3" strokeLinecap="round" className="friday-line-path" style={{ ['--len' as string]: len }} />
        {pts.map(({ x: px, y: py, s }) => (
          <Link key={s.id} to={`/app/events/${s.id}?tab=summary`} aria-description={`מפגש ${fmtShortDate(s.starts_at)}: הגיעו ${s.attended}, מתוכם ${s.new_count} חדשים`}>
            <circle cx={px} cy={py} r="7" fill="var(--color-paper)" stroke="var(--color-tide)" strokeWidth="3" />
            <text x={px} y={py - 14} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-ink)" style={{ fontFamily: 'var(--font-display)' }}>{s.attended}</text>
            <text x={px} y={base + 22} textAnchor="middle" fontSize="12.5" fill="var(--color-muted)">{fmtShortDate(s.starts_at)}</text>
          </Link>
        ))}
        {next && nextPt && (
          <Link to={`/app/events/${next.id}`} aria-description={`המפגש הבא, ${fmtShortDate(next.starts_at)}: ${next.registered} נרשמו`}>
            <circle cx={nextPt.x} cy={nextPt.y} r="10" fill="var(--color-light-wash)" stroke="var(--color-light)" strokeWidth="3" strokeDasharray="3 3" />
            <text x={nextPt.x} y={nextPt.y - 17} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-light-deep)" style={{ fontFamily: 'var(--font-display)' }}>{next.registered}</text>
            <text x={nextPt.x} y={base + 22} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--color-light-deep)">{fmtShortDate(next.starts_at)}</text>
            <text x={nextPt.x} y={base + 40} textAnchor="middle" fontSize="11.5" fill="var(--color-muted)">נרשמו</text>
          </Link>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-2.5 rounded-sm bg-ink/85" />חוזרים</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-2.5 rounded-sm bg-light" />חדשים</span>
        {next && <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-light" />נרשמו למפגש הבא</span>}
      </div>
    </div>
  );
}

/** A goal from the questionnaire (Q9) with its current value and a meter. */
export function GoalStat({ label, value, display, goal, goalDisplay, hint, onOpen, lowerIsBetter }: {
  label: string; value: number | null; display: string; goal: number; goalDisplay: string; hint?: string; onOpen?: () => void; lowerIsBetter?: boolean;
}) {
  const p = progress(value, goal);
  const met = value != null && (lowerIsBetter ? value <= goal : value >= goal);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[0.92rem] font-semibold text-ink-soft">{label}</span>
        {onOpen && <Icon name="chevron" size={16} className="mt-1 text-faint" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num font-display text-[2.1rem] leading-none text-ink">{display}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist-deep" aria-hidden="true">
        <div className={cx('h-full rounded-full', met ? 'bg-good' : 'bg-tide')} style={{ width: `${Math.min(100, (p ?? 0) * 100)}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">יעד <span className="num">{goalDisplay}</span></span>
        {value == null ? <span className="text-faint">אין עדיין נתונים</span> : met ? <span className="font-semibold text-good">עומד ביעד</span> : <span className="text-muted">מתחת ליעד</span>}
      </div>
      {hint && <p className="mt-1.5 text-xs leading-snug text-faint">{hint}</p>}
    </>
  );
  const cls = 'block w-full rounded-[var(--radius-panel)] border border-line-soft bg-paper p-4 text-right';
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cx(cls, 'transition-colors hover:border-tide/50')}>{body}</button>
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
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.95rem]">
              <span className="font-medium">{r.label}</span>
              <span className="num shrink-0 text-sm text-muted">{r.total} · {r.total ? pct(r.part / r.total) : '—'} {partLabel}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-mist-deep" aria-hidden="true">
              <div className="h-full bg-tide" style={{ width: `${(r.part / max) * 100}%` }} />
              <div className="h-full bg-tide/30" style={{ width: `${((r.total - r.part) / max) * 100}%` }} />
            </div>
            {r.note && <div className="mt-1 text-xs text-muted">{r.note}</div>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-5 text-sm text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-tide" />{partLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-tide/30" />{totalLabel}</span>
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
            <span className="num font-display text-sm">{d.total}</span>
            <div className="flex w-full max-w-14 flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${(d.total / max) * 150 + 2}px` }}>
              <div className="bg-light" style={{ height: `${d.total ? (d.highlight / d.total) * 100 : 0}%` }} />
              <div className="flex-1 bg-ink/85" />
            </div>
            <span className="text-center text-xs leading-tight text-muted">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
