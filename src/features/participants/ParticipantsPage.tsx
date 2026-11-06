import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useRole, can } from '@/lib/auth';
import { useSources } from '@/lib/data';
import { age, fmtDate, todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { toCsv, downloadFile } from '@/lib/csv';
import { ENGAGEMENT_HINT, ENGAGEMENT_LABEL } from '@/lib/labels';
import type { Engagement } from '@/lib/types';
import { Button, ButtonLink, EmptyState, ErrorBox, PageHeader, SearchInput, Select, Skeleton, Spinner, cx } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { ENGAGEMENT_ORDER, EngagementBadge, ago, useDebounced } from './shared';
import { cityCounts, engagementCounts, fetchRoster, fetchRosterAll, openTaskIds, type RosterFilters, type RosterRow, type RosterSort } from './roster';

const PAGE = 50;
const SORT_LABEL: Record<RosterSort, string> = {
  last: 'ביקור אחרון',
  fridays: 'מספר שישים',
  name: 'שם (א–ת)',
  joined: 'הצטרפו לאחרונה',
};

function useFilters() {
  const [sp, setSp] = useSearchParams();
  const f: RosterFilters = {
    q: sp.get('q') ?? '',
    status: (sp.get('status') as Engagement | null) ?? '',
    source: sp.get('source') ?? '',
    city: sp.get('city') ?? '',
    task: sp.get('task') === '1',
    consent: (sp.get('consent') as RosterFilters['consent'] | null) ?? '',
    sort: (sp.get('sort') as RosterSort | null) ?? 'last',
  };
  const set = (patch: Partial<RosterFilters>) => {
    const next = { ...f, ...patch };
    const out = new URLSearchParams();
    if (next.q) out.set('q', next.q);
    if (next.status) out.set('status', next.status);
    if (next.source) out.set('source', next.source);
    if (next.city) out.set('city', next.city);
    if (next.task) out.set('task', '1');
    if (next.consent) out.set('consent', next.consent);
    if (next.sort !== 'last') out.set('sort', next.sort);
    setSp(out, { replace: true });
  };
  return [f, set] as const;
}

export function ParticipantsPage() {
  const role = useRole();
  const toast = useToast();
  const location = useLocation();
  const sources = useSources();
  const [f, setF] = useFilters();
  const [term, setTerm] = useState(f.q);
  const q = useDebounced(term.trim(), 300);
  const [moreFilters, setMoreFilters] = useState(() => !!(f.source || f.city || f.task || f.consent));
  const [exporting, setExporting] = useState(false);

  // the debounced search goes to the URL (so "back" from a card returns to the same list)
  useEffect(() => {
    if (q !== f.q) setF({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const filters = useMemo(() => ({ ...f, q }), [f, q]);
  // "show more" grows the page; any change of search/filter/sort starts again from the first page
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE });
  const limit = paging.key === filterKey ? paging.limit : PAGE;

  const openIds = useQuery({ queryKey: ['followups', 'open_ids'], queryFn: openTaskIds, staleTime: 30_000 });
  const counts = useQuery({ queryKey: ['participants', 'engagement_counts'], queryFn: engagementCounts, staleTime: 60_000 });
  const cities = useQuery({ queryKey: ['participants', 'cities'], queryFn: cityCounts, staleTime: 5 * 60_000 });
  const needOpen = filters.task;
  const roster = useQuery({
    queryKey: ['participants', 'roster', filters, limit, needOpen ? openIds.data : null],
    enabled: !needOpen || !!openIds.data,
    placeholderData: keepPreviousData,
    queryFn: () => fetchRoster(filters, limit, needOpen ? openIds.data ?? [] : null),
  });

  const sourceLabel = useMemo(() => new Map((sources.data ?? []).map((s) => [s.id, s.label])), [sources.data]);
  const openSet = useMemo(() => new Set(openIds.data ?? []), [openIds.data]);
  const activeExtra = [f.source, f.city, f.task, f.consent].filter(Boolean).length;
  const anyFilter = !!(q || f.status || activeExtra);
  const rows = roster.data?.rows ?? [];
  const total = roster.data?.total ?? 0;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await fetchRosterAll(filters, filters.task ? openIds.data ?? [] : null);
      const { error } = await supabase.rpc('log_export', { p_kind: 'participants', p_rows: all.length });
      if (error) throw error;
      const csv = toCsv(all, [
        { header: 'שם', value: (r) => r.full_name },
        { header: 'טלפון', value: (r) => formatPhone(r.phone) },
        { header: 'עיר', value: (r) => r.city },
        { header: 'גיל', value: (r) => age(r.birth_year, r.birth_date) },
        { header: 'סטטוס', value: (r) => (r.stats ? ENGAGEMENT_LABEL[r.stats.engagement_status] : '') },
        { header: 'שישים', value: (r) => r.stats?.friday_count ?? 0 },
        { header: 'כל הפעילויות', value: (r) => r.stats?.attended_count ?? 0 },
        { header: 'ביקור ראשון', value: (r) => (r.stats?.first_attended_at ? fmtDate(r.stats.first_attended_at) : '') },
        { header: 'ביקור אחרון', value: (r) => (r.stats?.last_attended_at ? fmtDate(r.stats.last_attended_at) : '') },
        { header: 'לא הגיע/ה (פעמים)', value: (r) => r.stats?.no_show_count ?? 0 },
        { header: 'מקור היכרות', value: (r) => (r.first_source_id ? sourceLabel.get(r.first_source_id) : '') },
        { header: 'פירוט מקור', value: (r) => r.first_source_detail },
        { header: 'הסכמה לעדכונים', value: (r) => (r.consent_updates ? 'כן' : 'לא') },
        { header: 'לא להצטלם', value: (r) => (r.photo_opt_out ? 'כן' : '') },
        { header: 'הצטרפות', value: (r) => fmtDate(r.created_at) },
      ]);
      downloadFile(`lochamim-${todayIl()}.csv`, csv);
      toast.success(`יוצאו ${all.length} לוחמים. הייצוא נרשם ביומן הפעולות.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const clearAll = () => {
    setTerm('');
    setF({ q: '', status: '', source: '', city: '', task: false, consent: '' });
  };

  return (
    <div>
      <PageHeader
        title="לוחמים"
        subtitle={counts.data ? <><span className="num">{counts.data.all.toLocaleString('he-IL')}</span> לוחמים ולוחמות במערכת</> : 'כל מי שנרשם או הגיע למפגש'}
        actions={
          <>
            <ButtonLink to="/app/participants/new" icon="userPlus">לוחם/ת חדש/ה</ButtonLink>
            <ButtonLink to="/app/participants/duplicates" variant="secondary" icon="merge">כפילויות אפשריות</ButtonLink>
            {can.admin(role) && (
              <Button variant="ghost" icon="download" busy={exporting} onClick={exportCsv} disabled={!total}>ייצוא CSV</Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <SearchInput value={term} onChange={setTerm} label="חיפוש לוחמים" placeholder="חיפוש לפי שם, טלפון או עיר" />
          </div>
          <div className="flex gap-2">
            <Select aria-label="מיון" value={f.sort} onChange={(e) => setF({ sort: e.target.value as RosterSort })} className="sm:w-52">
              {(Object.keys(SORT_LABEL) as RosterSort[]).map((s) => <option key={s} value={s}>מיון: {SORT_LABEL[s]}</option>)}
            </Select>
            <button
              type="button"
              onClick={() => setMoreFilters((v) => !v)}
              aria-expanded={moreFilters}
              className={cx(
                'inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 font-semibold',
                moreFilters || activeExtra ? 'border-tide bg-tide-wash text-tide-deep' : 'border-line bg-paper text-ink',
              )}
            >
              <Icon name="filter" size={18} />
              סינון
              {activeExtra > 0 && <span className="num rounded-full bg-tide px-1.5 text-xs text-white">{activeExtra}</span>}
            </button>
          </div>
        </div>

        <StatusChips value={f.status} counts={counts.data} onChange={(status) => setF({ status })} />

        {moreFilters && (
          <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-panel)] border border-line-soft bg-paper p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="מקור היכרות" value={f.source} onChange={(e) => setF({ source: e.target.value })}>
              <option value="">כל המקורות</option>
              {(sources.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              <option value="none">לא ידוע</option>
            </Select>
            <Select label="עיר" value={f.city} onChange={(e) => setF({ city: e.target.value })}>
              <option value="">כל הערים</option>
              {(cities.data ?? []).map((c) => <option key={c.city} value={c.city}>{c.city} ({c.n})</option>)}
              {f.city && !cities.data?.some((c) => c.city === f.city) && <option value={f.city}>{f.city}</option>}
            </Select>
            <Select label="הסכמה לעדכונים בוואטסאפ" value={f.consent} onChange={(e) => setF({ consent: e.target.value as RosterFilters['consent'] })}>
              <option value="">הכול</option>
              <option value="yes">הסכימו</option>
              <option value="no">לא הסכימו</option>
            </Select>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">משימות מעקב</span>
              <label className="flex h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-line px-3.5">
                <input type="checkbox" checked={f.task} onChange={(e) => setF({ task: e.target.checked })} className="h-5 w-5 accent-tide" />
                <span>יש משימה פתוחה</span>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        {roster.isError ? (
          <ErrorBox error={errorMessage(roster.error)} onRetry={() => roster.refetch()} />
        ) : roster.isLoading || (!roster.data && roster.isFetching) ? (
          <div className="rounded-[var(--radius-panel)] border border-line-soft bg-paper p-5"><Skeleton lines={8} /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-line-soft bg-paper">
            {anyFilter ? (
              <EmptyState icon="search" title="לא נמצאו לוחמים" action={<Button variant="secondary" onClick={clearAll}>ניקוי החיפוש והסינון</Button>}>
                {q ? <>אין תוצאות עבור "{q}". אפשר לחפש לפי חלק מהשם, 4 ספרות אחרונות של הטלפון או עיר.</> : 'אף לוחם/ת לא מתאים/ה לסינון שנבחר.'}
              </EmptyState>
            ) : (
              <EmptyState icon="people" title="עוד אין לוחמים במערכת" action={<ButtonLink to="/app/participants/new" icon="userPlus">לוחם/ת חדש/ה</ButtonLink>}>
                לוחמים נוספים לכאן מעצמם כשנרשמים בטופס ההרשמה או נכנסים למפגש. אפשר גם להוסיף ידנית.
              </EmptyState>
            )}
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between text-sm text-muted">
              <span>
                {anyFilter ? 'נמצאו ' : ''}<span className="num font-semibold text-ink">{total.toLocaleString('he-IL')}</span> {total === 1 ? 'לוחם/ת' : 'לוחמים'}
              </span>
              {roster.isFetching && <span className="flex items-center gap-1.5"><Spinner size={14} />מעדכנים…</span>}
            </div>
            <RosterTable rows={rows} sourceLabel={sourceLabel} openSet={openSet} from={location.search} />
            <RosterCards rows={rows} sourceLabel={sourceLabel} openSet={openSet} from={location.search} />
            {rows.length < total && (
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <Button variant="secondary" busy={roster.isFetching} onClick={() => setPaging({ key: filterKey, limit: limit + PAGE })}>הצגת עוד</Button>
                <span className="text-sm text-muted">מוצגים <span className="num">{rows.length}</span> מתוך <span className="num">{total}</span></span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatusChips({ value, counts, onChange }: { value: Engagement | ''; counts?: Record<Engagement | 'all', number>; onChange: (v: Engagement | '') => void }) {
  const [help, setHelp] = useState(false);
  const chips: { v: Engagement | ''; label: string; hint?: string; n?: number }[] = [
    { v: '', label: 'כולם', n: counts?.all },
    ...ENGAGEMENT_ORDER.map((s) => ({ v: s, label: ENGAGEMENT_LABEL[s], hint: ENGAGEMENT_HINT[s], n: counts?.[s] })),
  ];
  return (
    <div>
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="סינון לפי סטטוס">
        {chips.map((c) => {
          const on = value === c.v;
          return (
            <button
              key={c.v || 'all'}
              type="button"
              aria-pressed={on}
              title={c.hint}
              onClick={() => onChange(c.v)}
              className={cx(
                'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.9rem] font-semibold transition-colors',
                on ? 'border-ink bg-ink text-mist' : 'border-line bg-paper text-ink-soft hover:border-ink-soft/50',
              )}
            >
              {c.label}
              {c.n != null && <span className={cx('num text-xs', on ? 'text-mist/75' : 'text-muted')}>{c.n}</span>}
            </button>
          );
        })}
        <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="inline-flex h-10 shrink-0 items-center gap-1 px-2 text-sm font-medium text-tide hover:underline">
          מה ההבדל?
        </button>
      </div>
      {help && (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 rounded-[var(--radius-control)] bg-tide-wash p-3.5 text-sm text-ink sm:grid-cols-[auto_1fr]">
          {ENGAGEMENT_ORDER.map((s) => (
            <div key={s} className="contents">
              <dt className="font-bold">{ENGAGEMENT_LABEL[s]}</dt>
              <dd className="mb-1.5 text-ink-soft sm:mb-0">{ENGAGEMENT_HINT[s]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type ListProps = { rows: RosterRow[]; sourceLabel: Map<string, string>; openSet: Set<string>; from: string };

function LastVisit({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="text-faint">—</span>;
  return <span title={fmtDate(at)}>{ago(at)}</span>;
}

function TaskMark() {
  return (
    <span title="יש משימת מעקב פתוחה" className="inline-flex text-tide">
      <Icon name="task" size={16} label="יש משימת מעקב פתוחה" />
    </span>
  );
}

function RosterTable({ rows, sourceLabel, openSet, from }: ListProps) {
  return (
    <div className="hidden overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper md:block">
      <table className="w-full text-[0.95rem]">
        <thead className="border-b border-line-soft bg-mist/60 text-right text-sm text-muted">
          <tr>
            <th className="px-4 py-2.5 font-semibold">שם</th>
            <th className="px-3 py-2.5 font-semibold">טלפון</th>
            <th className="px-3 py-2.5 font-semibold">עיר</th>
            <th className="px-3 py-2.5 font-semibold">גיל</th>
            <th className="px-3 py-2.5 font-semibold" title="מפגשי שישי שהגיע/ה אליהם">שישים</th>
            <th className="px-3 py-2.5 font-semibold" title="כל הפעילויות, כולל ערבי מדורה">פעילויות</th>
            <th className="px-3 py-2.5 font-semibold">ביקור אחרון</th>
            <th className="px-3 py-2.5 font-semibold">מקור</th>
            <th className="px-4 py-2.5 font-semibold">סטטוס</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((r) => {
            const a = age(r.birth_year, r.birth_date);
            return (
              <tr key={r.id} className="hover:bg-mist/50">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <Link to={`/app/participants/${r.id}`} state={{ from }} className="font-semibold text-ink hover:text-tide hover:underline">{r.full_name}</Link>
                    {openSet.has(r.id) && <TaskMark />}
                  </span>
                </td>
                <td className="px-3 py-2.5"><span className="num whitespace-nowrap text-ink-soft">{formatPhone(r.phone)}</span></td>
                <td className="px-3 py-2.5 text-ink-soft">{r.city ?? <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5"><span className="num">{a ?? '—'}</span></td>
                <td className="px-3 py-2.5"><span className="num font-semibold">{r.stats?.friday_count ?? 0}</span></td>
                <td className="px-3 py-2.5"><span className="num text-ink-soft">{r.stats?.attended_count ?? 0}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft"><LastVisit at={r.stats?.last_attended_at} /></td>
                <td className="max-w-40 truncate px-3 py-2.5 text-ink-soft" title={r.first_source_id ? sourceLabel.get(r.first_source_id) : undefined}>{r.first_source_id ? sourceLabel.get(r.first_source_id) : <span className="text-faint">—</span>}</td>
                <td className="px-4 py-2.5"><EngagementBadge status={r.stats?.engagement_status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RosterCards({ rows, sourceLabel, openSet, from }: ListProps) {
  return (
    <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper md:hidden">
      {rows.map((r) => {
        const a = age(r.birth_year, r.birth_date);
        const fridays = r.stats?.friday_count ?? 0;
        return (
          <li key={r.id}>
            <Link to={`/app/participants/${r.id}`} state={{ from }} className="flex flex-col gap-1 px-4 py-3 active:bg-mist">
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-semibold">{r.full_name}</span>
                  {openSet.has(r.id) && <TaskMark />}
                </span>
                <EngagementBadge status={r.stats?.engagement_status} />
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                <span className="num">{formatPhone(r.phone)}</span>
                {r.city && <><span aria-hidden="true">·</span><span>{r.city}</span></>}
                {a != null && <><span aria-hidden="true">·</span><span>גיל <span className="num">{a}</span></span></>}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
                <span><span className="num font-semibold">{fridays}</span> {fridays === 1 ? 'שישי' : 'שישים'}</span>
                {r.stats?.last_attended_at && <><span aria-hidden="true">·</span><span>ביקור אחרון <LastVisit at={r.stats.last_attended_at} /></span></>}
                {r.first_source_id && <><span aria-hidden="true">·</span><span className="truncate">{sourceLabel.get(r.first_source_id)}</span></>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
