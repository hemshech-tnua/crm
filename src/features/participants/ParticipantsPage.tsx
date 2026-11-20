import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useRole, can } from '@/lib/auth';
import { useSources } from '@/lib/data';
import { age, fmtDate, todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { toCsv, downloadFile } from '@/lib/csv';
import { ENGAGEMENT_HINT, ENGAGEMENT_LABEL } from '@/lib/labels';
import type { Engagement } from '@/lib/types';
import { Button, ButtonLink, EmptyState, ErrorBox, FilterChips, PageHeader, SearchInput, Select, Skeleton, Spinner, Table, Td, Th, cx } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { NoResults } from '@/ui/toolbar';
import { SEARCH_PLACEHOLDER_CITY } from '@/ui/search';
import { Icon } from '@/ui/Icon';
import { ENGAGEMENT_ORDER, EngagementBadge, ago, useDebounced } from './shared';
import { GONE_DAYS, cityCounts, engagementCounts, engagementCountsFor, fetchRoster, fetchRosterAll, openTaskIds, type RosterCounts, type RosterFilters, type RosterRow, type RosterSort } from './roster';

const PAGE = 50;
const SORT_LABEL: Record<RosterSort, string> = {
  last: 'הגעה אחרונה',
  longest: 'הכי הרבה זמן מאז ההגעה האחרונה',
  fridays: 'מספר מפגשי שישי',
  name: 'שם (א–ת)',
  joined: 'הצטרפו לאחרונה',
};

function fromParams(sp: URLSearchParams): RosterFilters {
  return {
    q: sp.get('q') ?? '',
    status: (sp.get('status') as Engagement | null) ?? '',
    source: sp.get('source') ?? '',
    city: sp.get('city') ?? '',
    task: sp.get('task') === '1',
    consent: (sp.get('consent') as RosterFilters['consent'] | null) ?? '',
    gone: sp.get('gone') === '1',
    sort: (sp.get('sort') as RosterSort | null) ?? 'last',
  };
}
function toParams(f: RosterFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.q) out.set('q', f.q);
  if (f.status) out.set('status', f.status);
  if (f.source) out.set('source', f.source);
  if (f.city) out.set('city', f.city);
  if (f.task) out.set('task', '1');
  if (f.consent) out.set('consent', f.consent);
  if (f.gone) out.set('gone', '1');
  if (f.sort !== 'last') out.set('sort', f.sort);
  return out;
}

/** Filters live in state (never stale between quick changes) and are mirrored to the URL, so "back" from a card restores the list. */
function useFilters(onExternalChange: (f: RosterFilters) => void) {
  const [sp, setSp] = useSearchParams();
  const [f, setState] = useState<RosterFilters>(() => fromParams(sp));
  const written = useRef(sp.toString());
  const set = useCallback((patch: Partial<RosterFilters>) => setState((x) => ({ ...x, ...patch })), []);
  useEffect(() => {
    const next = toParams(f).toString();
    if (next !== sp.toString()) {
      written.current = next;
      setSp(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  // the URL changed from outside (the nav link, browser history): follow it
  const current = sp.toString();
  useEffect(() => {
    if (current === written.current) return;
    written.current = current;
    const next = fromParams(new URLSearchParams(current));
    setState(next);
    onExternalChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  return [f, set] as const;
}

export function ParticipantsPage() {
  const role = useRole();
  const toast = useToast();
  const location = useLocation();
  const sources = useSources();
  const [term, setTerm] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [f, setF] = useFilters((next) => setTerm(next.q));
  const q = useDebounced(term.trim(), 300);
  const [moreFilters, setMoreFilters] = useState(() => !!(f.source || f.city || f.task || f.consent));
  const [exporting, setExporting] = useState(false);

  // the debounced search term joins the filters (and the URL)
  useEffect(() => setF({ q }), [q, setF]);
  const filters = f;
  // "show more" grows the page; any change of search/filter/sort starts again from the first page
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE });
  const limit = paging.key === filterKey ? paging.limit : PAGE;

  const openIds = useQuery({ queryKey: ['followups', 'open_ids'], queryFn: openTaskIds, staleTime: 30_000 });
  // the chip counts follow the search and the other filters (not the chip itself), so they say what a tap will show
  const countScope = { q: filters.q, source: filters.source, city: filters.city, consent: filters.consent, task: filters.task };
  const scoped = !!(filters.q || filters.source || filters.city || filters.consent || filters.task);
  const overall = useQuery({ queryKey: ['participants', 'engagement_counts', 'all'], queryFn: engagementCounts, staleTime: 60_000 });
  const filtered = useQuery({
    queryKey: ['participants', 'engagement_counts', countScope, filters.task ? openIds.data : null],
    enabled: scoped && (!filters.task || !!openIds.data),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: () => engagementCountsFor({ ...filters, status: '', gone: false }, filters.task ? openIds.data ?? [] : null),
  });
  const counts = scoped ? filtered : overall;
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
  const anyFilter = !!(q || f.status || f.gone || activeExtra);
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
        { header: 'מפגשי שישי', value: (r) => r.stats?.friday_count ?? 0 },
        { header: 'כל הפעילויות', value: (r) => r.stats?.attended_count ?? 0 },
        { header: 'הגעה ראשונה', value: (r) => (r.stats?.first_attended_at ? fmtDate(r.stats.first_attended_at) : '') },
        { header: 'הגעה אחרונה', value: (r) => (r.stats?.last_attended_at ? fmtDate(r.stats.last_attended_at) : '') },
        { header: 'הרשמות בלי הגעה', value: (r) => r.stats?.no_show_count ?? 0 },
        { header: 'מקור הגעה', value: (r) => (r.first_source_id ? sourceLabel.get(r.first_source_id) : '') },
        { header: 'פירוט מקור', value: (r) => r.first_source_detail },
        { header: 'הסכמה לעדכונים', value: (r) => (r.consent_updates ? 'כן' : 'לא') },
        { header: 'לא להצטלם', value: (r) => (r.photo_opt_out ? 'כן' : '') },
        { header: 'הצטרפות', value: (r) => fmtDate(r.created_at) },
      ]);
      downloadFile(`לוחמים-${todayIl()}.csv`, csv);
      toast.success(`הקובץ ירד: ${all.length.toLocaleString('he-IL')} לוחמים`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const clearAll = () => {
    setTerm('');
    setF({ q: '', status: '', source: '', city: '', task: false, consent: '', gone: false });
  };

  return (
    <div>
      <PageHeader
        title="לוחמים"
        subtitle={overall.data ? <><span className="num">{overall.data.all.toLocaleString('he-IL')}</span> לוחמים ולוחמות במערכת</> : 'כל מי שנרשם או הגיע למפגש'}
        actions={
          <>
            <ButtonLink to="/app/participants/new" icon="userPlus">כרטיס חדש</ButtonLink>
            <ButtonLink to="/app/participants/duplicates" variant="secondary" icon="merge">כפילויות אפשריות</ButtonLink>
            {can.admin(role) && (
              <Button variant="ghost" icon="download" busy={exporting} onClick={exportCsv} disabled={!total}>ייצוא לאקסל</Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <SearchInput value={term} onChange={setTerm} label="חיפוש לוחמים" placeholder={SEARCH_PLACEHOLDER_CITY} />
          </div>
          <div className="flex gap-2">
            <Select aria-label="מיון" value={f.sort} onChange={(e) => setF({ sort: e.target.value as RosterSort })} className="min-w-0 sm:w-80">
              {(Object.keys(SORT_LABEL) as RosterSort[]).map((s) => <option key={s} value={s}>מיון: {SORT_LABEL[s]}</option>)}
            </Select>
            <button
              type="button"
              onClick={() => setMoreFilters((v) => !v)}
              aria-expanded={moreFilters}
              className={cx(
                'inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 font-semibold transition-colors',
                moreFilters || activeExtra ? 'border-ink bg-ink text-light' : 'border-control-line bg-paper text-ink hover:border-ink',
              )}
            >
              <Icon name="filter" size={18} />
              סינון
              {activeExtra > 0 && <span className="num rounded-[2px] bg-light px-1.5 text-micro font-bold text-ink">{activeExtra}</span>}
            </button>
          </div>
        </div>

        <StatusChips
          value={f.gone ? 'gone' : f.status}
          counts={counts.data}
          onChange={(v) => setF(v === 'gone' ? { status: '', gone: true } : { status: v, gone: false })}
        />

        {moreFilters && (
          <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-panel)] border border-edge bg-paper p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="מקור הגעה" value={f.source} onChange={(e) => setF({ source: e.target.value })}>
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
              <span className="text-small font-medium">משימות מעקב</span>
              <label className="flex h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-control-line bg-paper px-3.5 hover:border-ink">
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
          <div className="rounded-[var(--radius-panel)] border border-edge bg-paper p-5"><Skeleton lines={8} /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-edge bg-paper">
            {f.gone && !q && !f.status && !activeExtra ? (
              <EmptyState icon="checkCircle" title="אין לוחמים שלא הגיעו מעל חודשיים">
                כל מי שהגיע אי פעם, הגיע גם בחודשיים האחרונים. מי שעוד לא הגיע בכלל נמצא בסינון "לפני הגעה ראשונה".
              </EmptyState>
            ) : anyFilter ? (
              <NoResults onClear={clearAll}>
                {q ? <>לא נמצא כרטיס עבור "{q}". אפשר לחפש לפי חלק מהשם, מספר טלפון (מלא או 4 ספרות אחרונות) או עיר.</> : 'אין כרטיסים שמתאימים לסינון שנבחר.'}
              </NoResults>
            ) : (
              <EmptyState icon="people" title="עוד אין לוחמים במערכת" action={<ButtonLink to="/app/participants/new" icon="userPlus">כרטיס חדש</ButtonLink>}>
                לוחמים נוספים לכאן מעצמם כשנרשמים בטופס ההרשמה או נכנסים למפגש. אפשר גם להוסיף ידנית.
              </EmptyState>
            )}
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between text-small text-muted">
              <span>
                {total === 1 ? (anyFilter ? 'נמצא כרטיס אחד' : 'כרטיס אחד') : <>{anyFilter ? 'נמצאו ' : ''}<span className="num font-semibold text-ink">{total.toLocaleString('he-IL')}</span> לוחמים</>}
              </span>
              {roster.isFetching && <span className="flex items-center gap-1.5"><Spinner size={14} />מעדכנים…</span>}
            </div>
            <RosterTable rows={rows} sourceLabel={sourceLabel} openSet={openSet} from={location.search} />
            <RosterCards rows={rows} sourceLabel={sourceLabel} openSet={openSet} from={location.search} />
            {rows.length < total && (
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <Button variant="secondary" busy={roster.isFetching} onClick={() => setPaging({ key: filterKey, limit: limit + PAGE })}>הצגת עוד</Button>
                <span className="text-small text-muted">מוצגים <span className="num">{rows.length}</span> מתוך <span className="num">{total}</span></span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type ChipValue = Engagement | '' | 'gone';

function StatusChips({ value, counts, onChange }: { value: ChipValue; counts?: RosterCounts; onChange: (v: ChipValue) => void }) {
  const [help, setHelp] = useState(false);
  const chips: { v: ChipValue; label: ReactNode; title?: string; n?: number }[] = [
    { v: '', label: 'הכול', n: counts?.all },
    ...ENGAGEMENT_ORDER.map((s) => ({
      v: s,
      // "הגעה שנפסקה" asks for a call: the warning mark, as on the row badge
      label: s === 'lapsed'
        ? <span className="inline-flex items-center gap-1"><Icon name="alert" size={15} className={value === s ? undefined : 'text-warn'} />{ENGAGEMENT_LABEL[s]}</span>
        : ENGAGEMENT_LABEL[s],
      title: ENGAGEMENT_HINT[s],
      n: counts?.[s],
    })),
    { v: 'gone', label: 'לא הגיעו מעל חודשיים', title: `ההגעה האחרונה הייתה לפני יותר מ-${GONE_DAYS} יום, בכל סטטוס`, n: counts?.gone },
  ];
  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <FilterChips label="סינון לפי סטטוס" value={value} onChange={onChange}
          options={chips.map((c) => ({ value: c.v, label: c.label, count: c.n, title: c.title }))} />
        <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="inline-flex h-10 shrink-0 items-center gap-1 self-start px-1 text-small font-medium text-tide hover:underline sm:self-auto sm:px-2">
          מה ההבדל?
        </button>
      </div>
      {help && (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 rounded-[var(--radius-panel)] border border-edge bg-paper p-3.5 text-small text-ink sm:grid-cols-[auto_1fr]">
          {ENGAGEMENT_ORDER.map((s) => (
            <div key={s} className="contents">
              <dt className="font-bold">{ENGAGEMENT_LABEL[s]}</dt>
              <dd className="mb-1.5 text-ink-soft sm:mb-0">{ENGAGEMENT_HINT[s]}</dd>
            </div>
          ))}
          <div className="contents">
            <dt className="font-bold">לא הגיעו מעל חודשיים</dt>
            <dd className="text-ink-soft">כל מי שההגעה האחרונה שלו הייתה לפני יותר מחודשיים, גם אם הגיע רק פעם אחת. למיון לפי מי שלא הגיע הכי הרבה זמן: "מיון: הכי הרבה זמן מאז ההגעה האחרונה".</dd>
          </div>
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
  const navigate = useNavigate();
  // the whole row opens the card; the name stays a real link (keyboard, middle-click, screen readers)
  const open = (e: MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('a,button') || window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey) window.open(`#/app/participants/${id}`, '_blank');
    else navigate(`/app/participants/${id}`, { state: { from } });
  };
  return (
    <Table className="hidden md:block" label="לוחמים">
        <thead>
          <tr>
            <Th>שם</Th>
            <Th>טלפון</Th>
            <Th>עיר</Th>
            <Th numeric>גיל</Th>
            <Th numeric><span title="הגעות למפגשי שישי">מפגשי שישי</span></Th>
            <Th numeric><span title="כל הפעילויות, כולל ערבי מדורה">פעילויות</span></Th>
            <Th>הגעה אחרונה</Th>
            <Th>מקור הגעה</Th>
            <Th>סטטוס</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = age(r.birth_year, r.birth_date);
            return (
              <tr key={r.id} onClick={(e) => open(e, r.id)} className="cursor-pointer hover:bg-mist/60">
                <Td>
                  <span className="flex items-center gap-1.5">
                    <Link to={`/app/participants/${r.id}`} state={{ from }} className="font-semibold text-ink hover:text-tide hover:underline">{r.full_name}</Link>
                    {openSet.has(r.id) && <TaskMark />}
                  </span>
                </Td>
                <Td><span className="num whitespace-nowrap text-ink-soft">{formatPhone(r.phone)}</span></Td>
                <Td className="text-ink-soft">{r.city ?? <span className="text-faint">—</span>}</Td>
                <Td numeric>{a ?? '—'}</Td>
                <Td numeric className="font-semibold">{r.stats?.friday_count ?? 0}</Td>
                <Td numeric className="text-ink-soft">{r.stats?.attended_count ?? 0}</Td>
                <Td className="whitespace-nowrap text-ink-soft"><LastVisit at={r.stats?.last_attended_at} /></Td>
                <Td className="max-w-40 truncate text-ink-soft"><span title={r.first_source_id ? sourceLabel.get(r.first_source_id) : undefined}>{r.first_source_id ? sourceLabel.get(r.first_source_id) : <span className="text-faint">—</span>}</span></Td>
                <Td><EngagementBadge status={r.stats?.engagement_status} /></Td>
              </tr>
            );
          })}
        </tbody>
    </Table>
  );
}

function RosterCards({ rows, sourceLabel, openSet, from }: ListProps) {
  return (
    <ul className="flex flex-col divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper md:hidden">
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
              <span className="flex flex-wrap items-center gap-x-2 text-small text-muted">
                <span className="num">{formatPhone(r.phone)}</span>
                {r.city && <><span aria-hidden="true">·</span><span>{r.city}</span></>}
                {a != null && <><span aria-hidden="true">·</span><span>גיל <span className="num">{a}</span></span></>}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-small text-ink-soft">
                <span><span className="num font-semibold">{fridays}</span> {fridays === 1 ? 'מפגש שישי' : 'מפגשי שישי'}</span>
                {r.stats?.last_attended_at && <><span aria-hidden="true">·</span><span>הגעה אחרונה <LastVisit at={r.stats.last_attended_at} /></span></>}
                {r.first_source_id && <><span aria-hidden="true">·</span><span className="truncate">{sourceLabel.get(r.first_source_id)}</span></>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
