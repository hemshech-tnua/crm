// Small building blocks shared by the event screens.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { fmtDay, fmtShortDate, fmtTime } from '@/lib/dates';
import { EVENT_STATUS_LABEL, freePlaces, meetingCountLine } from '@/lib/labels';
import type { EventRow, EventStats, EventStatus, EventType } from '@/lib/types';
import { Badge, cx } from '@/ui/kit';
import { Icon, type IconName } from '@/ui/Icon';

const TYPE_SHORT: Record<EventType, { label: string; icon: IconName; tone: 'tide' | 'neutral' }> = {
  friday: { label: 'שישי', icon: 'sun', tone: 'tide' },
  bonfire: { label: 'מדורה', icon: 'flame', tone: 'neutral' },
  other: { label: 'אחר', icon: 'calendar', tone: 'neutral' },
};

export function TypeBadge({ type }: { type: EventType }) {
  const t = TYPE_SHORT[type];
  return <Badge tone={t.tone} icon={t.icon}>{t.label}</Badge>;
}

const STATUS_TONE: Record<EventStatus, 'neutral' | 'good' | 'tide' | 'warn' | 'bad'> = {
  draft: 'warn',
  open: 'good',
  closed: 'tide',
  completed: 'neutral',
  cancelled: 'bad',
};

export function StatusBadge({ status, endsAt }: { status: EventStatus; endsAt?: string }) {
  if (endsAt && (status === 'open' || status === 'closed') && new Date(endsAt).getTime() < Date.now()) {
    return <Badge tone="warn" icon="alert">הסתיים, לא נסגר</Badge>;
  }
  const tone = STATUS_TONE[status];
  return <Badge tone={tone} icon={tone === 'warn' || tone === 'bad' ? 'alert' : status === 'completed' ? 'check' : undefined}>{EVENT_STATUS_LABEL[status]}</Badge>;
}

/** "09:00–11:30" (shown LTR). */
export const timeRange = (e: Pick<EventRow, 'starts_at' | 'ends_at'>) => `${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`;
/** "יום שישי, 13.11" */
export const shortWhen = (e: Pick<EventRow, 'starts_at'>) => `${fmtDay(e.starts_at)}, ${fmtShortDate(e.starts_at)}`;

export const hasStarted = (e: Pick<EventRow, 'starts_at'>, now = Date.now()) => new Date(e.starts_at).getTime() <= now;
export const hasEnded = (e: Pick<EventRow, 'ends_at'>, now = Date.now()) => new Date(e.ends_at).getTime() < now;
/** The door team may open an event's attendance list from 12h before it starts until 12h after it ends (server rule). */
export const inDoorWindow = (e: Pick<EventRow, 'starts_at' | 'ends_at'>, now = Date.now()) =>
  now >= new Date(e.starts_at).getTime() - 12 * 3600_000 && now <= new Date(e.ends_at).getTime() + 12 * 3600_000;

/** The meeting is over but nobody pressed "סגירת המפגש" (no-shows and tasks are still missing). */
export const isUnclosed = (e: Pick<EventRow, 'ends_at' | 'status'>, now = Date.now()) =>
  (e.status === 'open' || e.status === 'closed') && hasEnded(e, now);

/**
 * The one count definition for a meeting's places (used on the dashboard, the list, the meeting page and its tab):
 * registered = active registrations made ahead, walkIns = came without registering, taken = both together,
 * free = capacity − taken. "24 רשומים · 2 בלי הרשמה · 26 מתוך 28".
 */
export function seats(e: Pick<EventRow, 'capacity'> & { stats?: Pick<EventStats, 'registered_count' | 'walk_in_count' | 'waitlisted_count'> | null }) {
  const registered = e.stats?.registered_count ?? 0;
  const walkIns = e.stats?.walk_in_count ?? 0;
  const taken = registered + walkIns;
  const capacity = e.capacity ?? null;
  return {
    registered, walkIns, taken, capacity,
    waitlisted: e.stats?.waitlisted_count ?? 0,
    free: freePlaces(registered, walkIns, capacity),
    full: capacity != null && taken >= capacity,
  };
}

/** "24 רשומים · 2 בלי הרשמה · 26 מתוך 28" (parts that are 0 or unknown are left out). */
export function seatText(e: Parameters<typeof seats>[0], { waitlist = false }: { waitlist?: boolean } = {}) {
  const s = seats(e);
  const line = meetingCountLine(s.registered, s.walkIns, s.capacity);
  return waitlist && s.waitlisted ? `${line} · ${s.waitlisted} ברשימת המתנה` : line;
}

/** "3 מקומות פנויים" / "מקום פנוי אחד" / "אין מקומות פנויים" / "בלי הגבלת מקומות". */
export function freeText(e: Parameters<typeof seats>[0]) {
  const { free } = seats(e);
  return free == null ? 'בלי הגבלת מקומות' : free === 1 ? 'מקום פנוי אחד' : free ? `${free} מקומות פנויים` : 'אין מקומות פנויים';
}

/** A big number with its label. `highlight` uses the brand highlight: only for the one live/next number. */
export function BigStat({ label, value, sub, highlight, className = '' }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; highlight?: boolean; className?: string;
}) {
  return (
    <div className={cx('rounded-[var(--radius-panel)] border px-4 py-3', highlight ? 'border-ink bg-light' : 'border-edge bg-paper', className)}>
      <div className="text-small font-medium text-muted">{label}</div>
      <div className="num mt-1 text-right font-display text-stat text-ink">{value}</div>
      {sub && <div className="mt-1 text-small text-muted">{sub}</div>}
    </div>
  );
}

/** QR code rendered locally (no external service). */
export function QrImage({ value, size = 220, className = '', label }: { value: string; size?: number; className?: string; label: string }) {
  const src = useQrDataUrl(value, size);
  return src ? (
    <img src={src} width={size} height={size} alt={label} className={cx('block bg-white', className)} style={{ width: size, height: size }} />
  ) : (
    <div className={cx('skeleton', className)} style={{ width: size, height: size }} role="status" aria-label="טוען" />
  );
}

export function useQrDataUrl(value: string, size: number) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#142837', light: '#FFFFFF' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [value, size]);
  return src;
}

/** A link with its own copy button. The URL is shown LTR and can be selected. */
export function LinkRow({ label, url, onCopy, extra }: { label: ReactNode; url: string; onCopy: () => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-edge py-3 last:border-0 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        <div dir="ltr" className="truncate text-left text-small text-muted select-all">{url}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        {extra}
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-control-line bg-paper px-3 text-small font-semibold hover:border-ink hover:bg-ink/[0.06] pointer-coarse:h-11"
        >
          העתקה
        </button>
      </div>
    </div>
  );
}

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; icon?: IconName };

/** "More" menu for a row: secondary and destructive actions out of the way of the main one. */
export function RowMenu({ items, label = 'פעולות נוספות', big = false }: { items: MenuItem[]; label?: string; big?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (ev: PointerEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('inline-flex items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-ink/[0.07] hover:text-ink', big ? 'h-12 w-12' : 'h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11')}
      >
        <Icon name="more" size={big ? 24 : 20} />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-30 mt-1 min-w-48 rounded-[var(--radius-control)] border border-edge bg-paper py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick(); }}
              className={cx('flex h-12 w-full items-center gap-2.5 px-3.5 text-right font-medium hover:bg-ink/[0.06]', it.danger ? 'text-bad' : 'text-ink')}
            >
              {it.icon && <Icon name={it.icon} size={18} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Value that settles after the user stops typing. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
