import { useSearchParams } from 'react-router';
import { addDays, fmtMonth, todayIl } from '@/lib/dates';
import { useSites } from '@/lib/data';
import { Segmented } from '@/ui/kit';

export type PeriodKey = 'month' | 'prev_month' | '30d' | '90d' | 'year' | 'all' | 'custom';
export type Filters = { from: string | null; to: string | null; type: string | null; site: string | null; period: PeriodKey };

const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: 'month', label: 'החודש' },
  { key: 'prev_month', label: 'החודש הקודם' },
  { key: '30d', label: '30 יום' },
  { key: '90d', label: '3 חודשים' },
  { key: 'year', label: 'השנה' },
  { key: 'all', label: 'הכול' },
];

export function useFilters(defaults: { period?: PeriodKey; type?: string | null } = {}): [Filters, (patch: Partial<Record<string, string | null>>) => void] {
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey) ?? defaults.period ?? '90d';
  const type = params.has('type') ? (params.get('type') || null) : (defaults.type === undefined ? 'friday' : defaults.type);
  const site = params.get('site') || null;
  const today = todayIl();
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
  const range: Record<PeriodKey, [string | null, string | null]> = {
    // a whole calendar month: this month's meetings that are still ahead count too (their payments come in early)
    month: [monthStart, monthEnd(today)],
    prev_month: [prevStart, addDays(monthStart, -1)],
    '30d': [addDays(today, -30), today],
    '90d': [addDays(today, -91), today],
    year: [`${today.slice(0, 4)}-01-01`, today],
    all: [null, null],
    custom: [params.get('from'), params.get('to')],
  };
  const [from, to] = range[period] ?? range['90d'];
  const set = (patch: Partial<Record<string, string | null>>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  return [{ from, to, type, site, period }, set];
}

/** The last day of the month of a date ("2026-11-20" → "2026-11-30"). */
function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
}

/** The period in words, for titles and file names: "נובמבר 2026", "1.11–20.11.26", "מאז ומעולם". */
export function periodLabel(f: Pick<Filters, 'from' | 'to' | 'period'>): string {
  if (f.period === 'all' || (!f.from && !f.to)) return 'מאז ומעולם';
  if ((f.period === 'month' || f.period === 'prev_month') && f.from) return fmtMonth(`${f.from}T12:00:00Z`);
  const short = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
  if (f.from && f.to) return `${short(f.from)}–${short(f.to)}.${f.to.slice(2, 4)}`;
  return f.from ? `מ-${short(f.from)}.${f.from.slice(2, 4)}` : `עד ${short(f.to!)}.${f.to!.slice(2, 4)}`;
}

/** Report RPC arguments from the filters. */
export const rpcArgs = (f: Filters) => ({ p_from: f.from, p_to: f.to, p_type: f.type, p_site: f.site });

export function FilterBar({ filters, set, showType = true, custom = false }: {
  filters: Filters; set: (p: Partial<Record<string, string | null>>) => void; showType?: boolean; custom?: boolean;
}) {
  const sites = useSites();
  const periods: { value: PeriodKey; label: string }[] = custom ? [...PRESETS.map((p) => ({ value: p.key, label: p.label })), { value: 'custom', label: 'טווח' }] : PRESETS.map((p) => ({ value: p.key, label: p.label }));
  const date = 'h-11 rounded-[var(--radius-control)] border border-control-line bg-paper px-2 hover:border-ink';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* seven presets do not fit a phone: the row scrolls sideways inside the page instead of widening it */}
      <div className="-mx-4 max-w-[100vw] overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,#000_24px)] sm:mx-0 sm:max-w-full sm:px-0 sm:[mask-image:none]">
        <Segmented label="תקופה" options={periods} value={filters.period}
          onChange={(v) => v === 'custom'
            ? set({ period: 'custom', from: filters.from ?? addDays(todayIl(), -30), to: filters.to ?? todayIl() })
            : set({ period: v, from: null, to: null })} />
      </div>
      {filters.period === 'custom' && (
        <div className="flex items-center gap-1.5 text-small">
          <input type="date" aria-label="מתאריך" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} className={date} />
          <span className="text-muted">עד</span>
          <input type="date" aria-label="עד תאריך" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} className={date} />
        </div>
      )}
      {showType && (
        <Segmented label="סוג פעילות" value={filters.type ?? ''} onChange={(v) => set({ type: v })}
          options={[{ value: 'friday', label: 'שישי' }, { value: 'bonfire', label: 'מדורה' }, { value: '', label: 'כל הפעילויות' }]} />
      )}
      {(sites.data?.length ?? 0) > 1 && (
        <select aria-label="מתחם" value={filters.site ?? ''} onChange={(e) => set({ site: e.target.value || null })} className="h-11 rounded-[var(--radius-control)] border border-control-line bg-paper pr-3 pl-8 text-small font-medium hover:border-ink">
          <option value="">כל המתחמים</option>
          {sites.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}
