import { useSearchParams } from 'react-router';
import { addDays, todayIl } from '@/lib/dates';
import { useSites } from '@/lib/data';
import { cx } from '@/ui/kit';

export type PeriodKey = '30d' | '90d' | 'year' | 'all' | 'custom';
export type Filters = { from: string | null; to: string | null; type: string | null; site: string | null; period: PeriodKey };

const PRESETS: { key: PeriodKey; label: string }[] = [
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
  const range: Record<PeriodKey, [string | null, string | null]> = {
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

/** Report RPC arguments from the filters. */
export const rpcArgs = (f: Filters) => ({ p_from: f.from, p_to: f.to, p_type: f.type, p_site: f.site });

export function FilterBar({ filters, set, showType = true, custom = false }: {
  filters: Filters; set: (p: Partial<Record<string, string | null>>) => void; showType?: boolean; custom?: boolean;
}) {
  const sites = useSites();
  const seg = 'flex rounded-[var(--radius-control)] border border-line bg-paper p-1';
  const segBtn = (on: boolean) => cx('h-9 rounded-lg px-3 text-sm font-semibold transition-colors', on ? 'bg-ink text-mist' : 'text-ink-soft hover:bg-mist');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={seg} role="group" aria-label="תקופה">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={filters.period === p.key} className={segBtn(filters.period === p.key)} onClick={() => set({ period: p.key, from: null, to: null })}>
            {p.label}
          </button>
        ))}
        {custom && (
          <button type="button" aria-pressed={filters.period === 'custom'} className={segBtn(filters.period === 'custom')}
            onClick={() => set({ period: 'custom', from: filters.from ?? addDays(todayIl(), -30), to: filters.to ?? todayIl() })}>
            טווח
          </button>
        )}
      </div>
      {filters.period === 'custom' && (
        <div className="flex items-center gap-1.5 text-sm">
          <input type="date" aria-label="מתאריך" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} className="h-11 rounded-[var(--radius-control)] border border-line bg-paper px-2" />
          <span className="text-muted">עד</span>
          <input type="date" aria-label="עד תאריך" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} className="h-11 rounded-[var(--radius-control)] border border-line bg-paper px-2" />
        </div>
      )}
      {showType && (
        <div className={seg} role="group" aria-label="סוג פעילות">
          {[{ v: 'friday', l: 'שישי' }, { v: 'bonfire', l: 'מדורה' }, { v: '', l: 'כל הפעילויות' }].map((t) => (
            <button key={t.v} type="button" aria-pressed={(filters.type ?? '') === t.v} className={segBtn((filters.type ?? '') === t.v)} onClick={() => set({ type: t.v })}>
              {t.l}
            </button>
          ))}
        </div>
      )}
      {(sites.data?.length ?? 0) > 1 && (
        <select aria-label="מתחם" value={filters.site ?? ''} onChange={(e) => set({ site: e.target.value || null })} className="h-11 rounded-[var(--radius-control)] border border-line bg-paper px-3 text-sm font-semibold">
          <option value="">כל המתחמים</option>
          {sites.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}
