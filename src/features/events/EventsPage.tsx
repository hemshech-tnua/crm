import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useSpeakers, type EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { fmtListDate, ilParts, relativeDays, todayIl } from '@/lib/dates';
import { num, pct, ratio } from '@/lib/metrics';
import type { EventType, Speaker } from '@/lib/types';
import { Badge, ButtonLink, Button, EmptyState, ErrorBox, FilterChips, Notice, PageHeader, Panel, SearchInput, Segmented, Skeleton, Table, Tabs, Td, Th, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { NoResults } from '@/ui/toolbar';
import { StatusBadge, TypeBadge, isUnclosed, registeredText, seats, timeRange, useDebounced } from './shared';
import { useCancelledAheadCount, useEventList, useUnclosedCount } from './queries';

type Show = 'upcoming' | 'past';
type UpStatus = 'all' | 'draft' | 'nospeaker' | 'waitlist' | 'cancelled';
type PastStatus = 'all' | 'unclosed';
type TypeFilter = 'all' | EventType;
const PAST_PAGE = 30;
const UP_STATUSES: UpStatus[] = ['all', 'draft', 'nospeaker', 'waitlist', 'cancelled'];

/** A Friday meeting with no speaker yet (cancelled and closed ones need none). */
const noSpeaker = (e: EventWithStats) => e.type === 'friday' && !e.speaker_id && e.status !== 'cancelled' && e.status !== 'completed';

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status') ?? 'all';
  // "לא נסגרו" lives under "קודמים": a link with ?status=unclosed opens it there
  const show: Show = params.get('show') === 'past' || rawStatus === 'unclosed' ? 'past' : 'upcoming';
  const upStatus: UpStatus = UP_STATUSES.includes(rawStatus as UpStatus) ? (rawStatus as UpStatus) : 'all';
  const pastStatus: PastStatus = rawStatus === 'unclosed' ? 'unclosed' : 'all';
  const rawType = params.get('type');
  const type: TypeFilter = rawType === 'friday' || rawType === 'bonfire' || rawType === 'other' ? rawType : 'all';
  const query = params.get('q') ?? '';
  const [typed, setTyped] = useState(query);
  const search = useDebounced(typed, 300).trim();
  const patch = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) {
      if (v == null || v === '' || v === 'all') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  // the settled search goes into the URL, so going back from a meeting returns to the same list
  useEffect(() => { if (search !== query) patch({ q: search || null }); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // one "now" per visit, so the query keys stay stable
  const [now] = useState(() => Date.now());
  const [pastLimit, setPastLimit] = useState(PAST_PAGE);
  const nowIso = useMemo(() => new Date(now).toISOString(), [now]);

  // cancelled meetings are hidden from "קרובים" unless asked for: fetched apart, so they never crowd out the rest
  const activeQ = useEventList({ endsAfter: nowIso, notStatuses: ['cancelled'], ascending: true });
  const cancelledQ = useEventList({ endsAfter: nowIso, statuses: ['cancelled'], ascending: true, limit: 200 }, show === 'upcoming' && upStatus === 'cancelled');
  const cancelledCount = useCancelledAheadCount(nowIso).data ?? 0;
  const upcomingQ = upStatus === 'cancelled' ? cancelledQ : activeQ;
  const pastQ = useEventList({
    to: nowIso, endsBefore: nowIso, ascending: false, limit: pastLimit,
    type: type === 'all' ? null : type, search: search || undefined,
    statuses: pastStatus === 'unclosed' ? ['open', 'closed'] : undefined,
  }, show === 'past');
  const unclosedQ = useUnclosedCount(nowIso);
  const unclosed = unclosedQ.data ?? 0;
  const speakers = useSpeakers();
  const byId = useMemo(() => new Map((speakers.data ?? []).map((s) => [s.id, s])), [speakers.data]);

  const upcomingAll = useMemo(() => (upcomingQ.data ?? []).filter((e) => new Date(e.ends_at).getTime() >= now), [upcomingQ.data, now]);
  // type and search first, then the status chips count what is left
  const upcomingBase = useMemo(() => {
    const t = search.toLowerCase();
    return upcomingAll.filter((e) => {
      if (type !== 'all' && e.type !== type) return false;
      if (!t) return true;
      const sp = e.speaker_id ? byId.get(e.speaker_id)?.full_name : null;
      return [e.title, e.lecture_topic, e.activity_name, sp].some((x) => x?.toLowerCase().includes(t));
    });
  }, [upcomingAll, type, search, byId]);
  // the chip the dashboard links to: no speaker, or one not approved yet (the dashboard's "בלי מרצה מאושר" counts both)
  const needsSpeaker = (e: EventWithStats) => noSpeaker(e) || (e.type === 'friday' && !!e.speaker_id
    && e.status !== 'cancelled' && e.status !== 'completed' && byId.get(e.speaker_id) != null && byId.get(e.speaker_id)!.status !== 'approved');
  const upCounts: Record<UpStatus, number> = {
    all: upcomingBase.filter((e) => e.status !== 'cancelled').length,
    draft: upcomingBase.filter((e) => e.status === 'draft').length,
    nospeaker: upcomingBase.filter(needsSpeaker).length,
    waitlist: upcomingBase.filter((e) => e.status !== 'cancelled' && seats(e).waitlisted > 0).length,
    cancelled: upStatus === 'cancelled' ? upcomingBase.length : cancelledCount,
  };
  const upcoming = upcomingBase.filter((e) =>
    upStatus === 'all' ? e.status !== 'cancelled'
      : upStatus === 'draft' ? e.status === 'draft'
        : upStatus === 'nospeaker' ? needsSpeaker(e)
          : upStatus === 'waitlist' ? e.status !== 'cancelled' && seats(e).waitlisted > 0
            : e.status === 'cancelled');
  const past = useMemo(() => (pastQ.data ?? []).filter((e) => new Date(e.ends_at).getTime() < now), [pastQ.data, now]);
  // the next real meeting gets the single highlight (navy edge)
  const nextId = (activeQ.data ?? []).find((e) => e.status === 'open' || e.status === 'closed')?.id;

  const q = show === 'upcoming' ? upcomingQ : pastQ;
  const list = show === 'upcoming' ? upcoming : past;
  const filtered = !!search || type !== 'all' || (show === 'upcoming' ? upStatus !== 'all' : pastStatus !== 'all');
  const clear = () => { setTyped(''); patch({ q: null, type: null, status: null }); };

  const upChips: { value: UpStatus; label: string; count?: number }[] = [
    { value: 'all', label: 'הכול', count: upCounts.all },
    { value: 'draft', label: 'טיוטה', count: upCounts.draft },
    { value: 'nospeaker', label: 'בלי מרצה מאושר', count: upCounts.nospeaker },
    ...(upCounts.waitlist || upStatus === 'waitlist' ? [{ value: 'waitlist' as const, label: 'רשימת המתנה', count: upCounts.waitlist }] : []),
    ...(upCounts.cancelled || upStatus === 'cancelled' ? [{ value: 'cancelled' as const, label: 'בוטלו', count: upCounts.cancelled }] : []),
  ];
  const pastChips: { value: PastStatus; label: string; count?: number }[] = [
    { value: 'all', label: 'הכול' },
    { value: 'unclosed', label: 'לא נסגרו', count: unclosedQ.data },
  ];

  return (
    <>
      <PageHeader
        title="מפגשים"
        subtitle="מפגשי שישי, ערבי מדורה ומפגשים אחרים"
        actions={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}
      />
      <Tabs
        label="מפגשים"
        value={show}
        onChange={(v) => patch({ show: v === 'past' ? 'past' : null, status: null })}
        tabs={[
          { value: 'upcoming', label: 'קרובים', count: activeQ.data && upStatus !== 'cancelled' ? upCounts.all : undefined },
          { value: 'past', label: unclosed ? <span className="flex items-center gap-1.5">קודמים<span className="h-2 w-2 rounded-[var(--radius-control)] bg-warn" aria-label={`${unclosed} לא נסגרו`} /></span> : 'קודמים' },
        ]}
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 sm:w-80">
            <SearchInput value={typed} onChange={setTyped} label="חיפוש מפגש" placeholder={show === 'upcoming' ? 'חיפוש לפי שם, מרצה או נושא' : 'חיפוש לפי שם או נושא'} />
          </div>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Segmented<TypeFilter>
              label="סוג המפגש"
              value={type}
              onChange={(v) => patch({ type: v })}
              options={[
                { value: 'all', label: 'כל סוגי המפגשים' },
                { value: 'friday', label: 'שישי' },
                { value: 'bonfire', label: 'מדורה' },
                { value: 'other', label: 'אחר' },
              ]}
            />
          </div>
        </div>
        {show === 'upcoming'
          ? <FilterChips<UpStatus> label="סינון לפי סטטוס" value={upStatus} onChange={(v) => patch({ status: v })} options={upChips} />
          : <FilterChips<PastStatus> label="סינון לפי סטטוס" value={pastStatus} onChange={(v) => patch({ status: v })} options={pastChips} />}
      </div>

      {q.isLoading ? (
        <Skeleton shape="rows" count={6} height={72} />
      ) : q.isError && !q.data ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Panel>
          {filtered ? (
            <NoResults onClear={clear}>
              {show === 'past' && pastStatus === 'unclosed' && !search && type === 'all' ? 'כל המפגשים שהסתיימו כבר נסגרו.' : null}
            </NoResults>
          ) : show === 'upcoming' ? (
            <EmptyState icon="calendar" title="אין מפגשים קרובים" action={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}>
              אפשר ליצור מפגש חדש, או לשכפל את המפגש האחרון מלשונית "קודמים".
            </EmptyState>
          ) : (
            <EmptyState icon="calendar" title="עוד לא התקיימו מפגשים">אחרי כל מפגש יופיעו כאן הנוכחות, החדשים והדירוג.</EmptyState>
          )}
        </Panel>
      ) : show === 'upcoming' ? (
        <UpcomingList events={list} speakers={byId} nextId={nextId} now={now} />
      ) : (
        <>
          {unclosed > 0 && pastStatus !== 'unclosed' && (
            <div className="mb-4">
              <Notice tone="warn" icon="alert">
                {unclosed === 1 ? 'מפגש אחד הסתיים ולא נסגר.' : <><span className="num">{unclosed}</span> מפגשים הסתיימו ולא נסגרו.</>} בסגירה מסומנים מי שלא הגיעו ונוצרות משימות מעקב.{' '}
                <button type="button" className="font-bold underline" onClick={() => patch({ status: 'unclosed' })}>להצגת המפגשים שלא נסגרו</button>
              </Notice>
            </div>
          )}
          <PastList events={list} now={now} />
          {(pastQ.data?.length ?? 0) >= pastLimit && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" busy={pastQ.isFetching} onClick={() => setPastLimit((n) => n + PAST_PAGE)}>עוד מפגשים קודמים</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ───────────── upcoming ─────────────

function speakerText(e: EventWithStats, speakers: Map<string, Speaker>) {
  const sp = e.speaker_id ? speakers.get(e.speaker_id) : undefined;
  return { name: sp?.full_name ?? null, pending: sp ? sp.status !== 'approved' : false, topic: e.lecture_topic };
}

/** Places taken (registered + walk-ins) out of capacity: the same numbers as the meeting page. */
function Capacity({ e }: { e: EventWithStats }) {
  const st = seats(e);
  return (
    <span className={cx('num font-semibold', st.full && 'text-bad')} title={`${registeredText(st.registered)}${st.walkIns ? ` · ${st.walkIns} בלי הרשמה` : ''}`}>
      {st.taken}
      <span className="font-normal text-muted">/{st.capacity ?? '∞'}</span>
    </span>
  );
}

/** "בלי מרצה": the warning colour only when it is close (a week or less), muted before that. */
function NoSpeakerBadge({ e, now }: { e: EventWithStats; now: number }) {
  const soon = new Date(e.starts_at).getTime() - now < 7 * 864e5;
  return <Badge tone={soon ? 'warn' : 'neutral'} icon="mic">בלי מרצה</Badge>;
}

function WhenCell({ e, highlight }: { e: EventWithStats; highlight?: boolean }) {
  const today = ilParts(e.starts_at).date === todayIl();
  return (
    <div className="flex items-stretch gap-3">
      <span className={cx('w-1 shrink-0 rounded-[var(--radius-control)]', highlight ? 'bg-ink' : 'bg-transparent')} aria-hidden="true" />
      <div>
        <div className="font-semibold tabular-nums">{fmtListDate(e.starts_at, { time: false })}</div>
        <div className="flex items-center gap-1.5 text-small text-muted">
          <span className="num">{timeRange(e)}</span>
          {today ? <span className="font-semibold text-ink">· היום</span> : highlight ? <span>· {relativeDays(e.starts_at)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function UpcomingList({ events, speakers, nextId, now }: { events: EventWithStats[]; speakers: Map<string, Speaker>; nextId?: string; now: number }) {
  const navigate = useNavigate();
  return (
    <>
      {/* phone: rows */}
      <ul className="flex flex-col gap-2.5 md:hidden">
        {events.map((e) => {
          const sp = speakerText(e, speakers);
          return (
            <li key={e.id}>
              <Link
                to={`/app/events/${e.id}`}
                className={cx(
                  'block rounded-[var(--radius-panel)] border bg-paper p-4 transition-colors hover:border-ink',
                  e.id === nextId ? 'border-ink' : 'border-edge',
                  e.status === 'cancelled' && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <WhenCell e={e} highlight={e.id === nextId} />
                  <StatusBadge status={e.status} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <TypeBadge type={e.type} />
                  <span className={cx('font-bold', e.status === 'cancelled' && 'line-through')}>{e.title}</span>
                </div>
                {(sp.name || sp.topic) && (
                  <div className="mt-1 text-small text-ink-soft">
                    {sp.name ?? 'בלי מרצה'}{sp.topic ? `: ${sp.topic}` : ''}
                    {sp.pending && <span className="ms-1.5 font-medium text-muted">(מחכה לאישור)</span>}
                  </div>
                )}
                <div className="mt-2.5 flex items-center gap-4 text-small">
                  <span className="flex items-center gap-1.5"><Icon name="people" size={16} className="text-muted" />רשומים <Capacity e={e} /></span>
                  {(e.stats?.waitlisted_count ?? 0) > 0 && <span>רשימת המתנה <span className="num font-semibold">{e.stats!.waitlisted_count}</span></span>}
                  {noSpeaker(e) && <NoSpeakerBadge e={e} now={now} />}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* desktop: table */}
      <Table className="hidden md:block" label="מפגשים קרובים">
          <thead>
            <tr>
              <Th>מתי</Th>
              <Th>מפגש</Th>
              <Th>סטטוס</Th>
              <Th numeric>רשומים</Th>
              <Th numeric>רשימת המתנה</Th>
              <Th>מרצה ונושא</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const sp = speakerText(e, speakers);
              return (
                <tr
                  key={e.id}
                  onClick={() => navigate(`/app/events/${e.id}`)}
                  className={cx('cursor-pointer hover:bg-mist/60', e.status === 'cancelled' && 'text-muted')}
                >
                  <Td className="ps-3!"><WhenCell e={e} highlight={e.id === nextId} /></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <TypeBadge type={e.type} />
                      <Link to={`/app/events/${e.id}`} onClick={(ev) => ev.stopPropagation()} className={cx('font-bold hover:text-tide hover:underline', e.status === 'cancelled' && 'line-through')}>
                        {e.title}
                      </Link>
                    </div>
                  </Td>
                  <Td><StatusBadge status={e.status} /></Td>
                  <Td numeric><Capacity e={e} /></Td>
                  <Td numeric>{e.stats?.waitlisted_count ? e.stats.waitlisted_count : <span className="text-faint">—</span>}</Td>
                  <Td className="max-w-72">
                    {sp.name || sp.topic ? (
                      <div className="leading-snug">
                        <div className="font-medium">
                          {sp.name ?? <span className="text-muted">בלי מרצה</span>}
                          {sp.pending && <span className="ms-1.5 text-small text-muted">(מחכה לאישור)</span>}
                        </div>
                        {sp.topic && <div className="truncate text-small text-muted">{sp.topic}</div>}
                      </div>
                    ) : noSpeaker(e) ? (
                      <NoSpeakerBadge e={e} now={now} />
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
      </Table>
    </>
  );
}

// ───────────── past ─────────────

function pastNumbers(e: EventWithStats) {
  const s = e.stats;
  const held = e.status !== 'cancelled' && e.status !== 'draft';
  return {
    attended: held ? num(s?.attended_count) : '—',
    newRet: held && s && s.attended_count > 0 ? <NewReturning n={s.new_count} r={s.returning_count} /> : '—',
    show: held ? pct(ratio(s?.attended_registered_count ?? 0, s?.registered_count ?? 0)) : '—',
    rating: s?.avg_overall != null ? num(s.avg_overall, 1) : '—',
    feedback: s?.feedback_count ?? 0,
  };
}

function UnclosedBadge() {
  return <Badge tone="warn" icon="alert" title="המפגש הסתיים ולא נסגר: לא סומנו מי שלא הגיעו ולא נוצרו משימות מעקב">לא נסגר</Badge>;
}

function PastList({ events, now }: { events: EventWithStats[]; now: number }) {
  const navigate = useNavigate();
  return (
    <>
      <ul className="flex flex-col gap-2.5 md:hidden">
        {events.map((e) => {
          const n = pastNumbers(e);
          return (
            <li key={e.id}>
              <Link to={`/app/events/${e.id}`} className={cx('block rounded-[var(--radius-panel)] border border-edge bg-paper p-4 hover:border-ink', e.status === 'cancelled' && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold tabular-nums">{fmtListDate(e.starts_at)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2"><TypeBadge type={e.type} /><span className="font-bold">{e.title}</span></div>
                  </div>
                  {isUnclosed(e, now) ? <UnclosedBadge /> : <StatusBadge status={e.status} />}
                </div>
                {e.status !== 'cancelled' && (
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <MiniStat label="הגיעו" value={n.attended} />
                    <MiniStat label="חדשים / חוזרים" value={n.newRet} />
                    <MiniStat label="שיעור הגעה" value={n.show} />
                    <MiniStat label="דירוג" value={n.rating} />
                  </dl>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <Table className="hidden md:block" label="מפגשים קודמים">
          <thead>
            <tr>
              <Th>מתי</Th>
              <Th>מפגש</Th>
              <Th numeric>הגיעו</Th>
              <Th>חדשים / חוזרים</Th>
              <Th numeric><span title="מבין מי שנרשם מראש ולא ביטל">שיעור הגעה</span></Th>
              <Th numeric>דירוג</Th>
              <Th>סטטוס</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const n = pastNumbers(e);
              return (
                <tr key={e.id} onClick={() => navigate(`/app/events/${e.id}`)} className={cx('cursor-pointer hover:bg-mist/60', e.status === 'cancelled' && 'text-muted')}>
                  <Td>
                    <div className="font-semibold tabular-nums">{fmtListDate(e.starts_at)}</div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <TypeBadge type={e.type} />
                      <Link to={`/app/events/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="font-bold hover:text-tide hover:underline">{e.title}</Link>
                    </div>
                  </Td>
                  <Td numeric className="font-semibold">{n.attended}</Td>
                  <Td>{n.newRet}</Td>
                  <Td numeric>{n.show}</Td>
                  <Td numeric>
                    {n.feedback > 0 && <span className="me-1 text-small text-muted">({n.feedback})</span>}
                    {n.rating}
                  </Td>
                  <Td>{isUnclosed(e, now) ? <UnclosedBadge /> : <StatusBadge status={e.status} />}</Td>
                </tr>
              );
            })}
          </tbody>
      </Table>
    </>
  );
}

/** "new / returning" in reading order (RTL): new on the right, like the column header. */
function NewReturning({ n, r }: { n: number; r: number }) {
  return <span dir="rtl"><span className="num">{n}</span> / <span className="num">{r}</span></span>;
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col-reverse rounded-[var(--radius-control)] bg-mist px-1 py-1.5">
      <dt className="text-micro text-muted">{label}</dt>
      <dd className="text-heading font-bold tabular-nums">{value}</dd>
    </div>
  );
}
