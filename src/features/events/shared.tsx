// Small building blocks shared by the event screens.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { fmtDay, fmtShortDate, fmtTime } from '@/lib/dates';
import { EVENT_STATUS_LABEL } from '@/lib/labels';
import type { EventRow, EventStatus, EventType } from '@/lib/types';
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

export function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={STATUS_TONE[status]} icon={status === 'completed' ? 'check' : undefined}>{EVENT_STATUS_LABEL[status]}</Badge>;
}

/** "09:00–11:30" (shown LTR). */
export const timeRange = (e: Pick<EventRow, 'starts_at' | 'ends_at'>) => `${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`;
/** "יום שישי, 13.11" */
export const shortWhen = (e: Pick<EventRow, 'starts_at'>) => `${fmtDay(e.starts_at)}, ${fmtShortDate(e.starts_at)}`;

export const hasStarted = (e: Pick<EventRow, 'starts_at'>, now = Date.now()) => new Date(e.starts_at).getTime() <= now;
export const hasEnded = (e: Pick<EventRow, 'ends_at'>, now = Date.now()) => new Date(e.ends_at).getTime() < now;
/** The meeting is over but nobody pressed "סגירת המפגש" (no-shows and tasks are still missing). */
export const isUnclosed = (e: Pick<EventRow, 'ends_at' | 'status'>, now = Date.now()) =>
  (e.status === 'open' || e.status === 'closed') && hasEnded(e, now);

/** A big number with its label. `highlight` uses the saffron accent: only for the one live/next number. */
export function BigStat({ label, value, sub, highlight, className = '' }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; highlight?: boolean; className?: string;
}) {
  return (
    <div className={cx('rounded-[var(--radius-control)] px-4 py-3', highlight ? 'bg-light-wash' : 'bg-mist', className)}>
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="num mt-0.5 text-right font-display text-[2rem] leading-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
    </div>
  );
}

/** QR code rendered locally (no external service). */
export function QrImage({ value, size = 220, className = '', label }: { value: string; size?: number; className?: string; label: string }) {
  const src = useQrDataUrl(value, size);
  return src ? (
    <img src={src} width={size} height={size} alt={label} className={cx('block bg-white', className)} style={{ width: size, height: size }} />
  ) : (
    <div className={cx('skeleton', className)} style={{ width: size, height: size }} aria-label="טוען" />
  );
}

export function useQrDataUrl(value: string, size: number) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#12343B', light: '#FFFFFF' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [value, size]);
  return src;
}

/** A link with its own copy button. The URL is shown LTR and can be selected. */
export function LinkRow({ label, url, onCopy, extra }: { label: ReactNode; url: string; onCopy: () => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line-soft py-3 last:border-0 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        <div dir="ltr" className="truncate text-left text-sm text-muted select-all">{url}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        {extra}
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-paper px-3 text-sm font-semibold hover:border-tide hover:text-tide"
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
        className={cx('inline-flex items-center justify-center rounded-full text-ink-soft hover:bg-mist-deep hover:text-ink', big ? 'h-12 w-12' : 'h-10 w-10')}
      >
        <Icon name="more" size={big ? 24 : 20} />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-30 mt-1 min-w-48 rounded-[var(--radius-control)] border border-line bg-paper py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick(); }}
              className={cx('flex h-12 w-full items-center gap-2.5 px-3.5 text-right font-medium hover:bg-mist', it.danger ? 'text-bad' : 'text-ink')}
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
