import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useEventsWithStats, useSpeakers, type EventWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { fmtDay, fmtShortDate, fmtTime, ilParts, relativeDays, todayIl } from '@/lib/dates';
import { num, pct, ratio } from '@/lib/metrics';
import type { Speaker } from '@/lib/types';
import { Badge, ButtonLink, Button, EmptyState, ErrorBox, PageHeader, Panel, Skeleton, Tabs, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { StatusBadge, TypeBadge, isUnclosed, timeRange } from './shared';

type Show = 'upcoming' | 'past';
const PAST_PAGE = 30;

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const show: Show = params.get('show') === 'past' ? 'past' : 'upcoming';
  // one "now" per visit, so the query keys stay stable
  const [now] = useState(() => Date.now());
  const [pastLimit, setPastLimit] = useState(PAST_PAGE);
  // the longest event is 24h, so anything that started more than a day ago has ended
  const dayAgo = useMemo(() => new Date(now - 24 * 3600_000).toISOString(), [now]);
  const nowIso = useMemo(() => new Date(now).toISOString(), [now]);

  const upcomingQ = useEventsWithStats({ from: dayAgo, ascending: true });
  const pastQ = useEventsWithStats({ to: nowIso, ascending: false, limit: pastLimit });
  const speakers = useSpeakers();
  const byId = useMemo(() => new Map((speakers.data ?? []).map((s) => [s.id, s])), [speakers.data]);

  const upcoming = useMemo(() => (upcomingQ.data ?? []).filter((e) => new Date(e.ends_at).getTime() >= now), [upcomingQ.data, now]);
  const past = useMemo(() => (pastQ.data ?? []).filter((e) => new Date(e.ends_at).getTime() < now), [pastQ.data, now]);
  const unclosed = past.filter((e) => isUnclosed(e, now)).length;
  // the next real meeting gets the single saffron highlight
  const nextId = upcoming.find((e) => e.status === 'open' || e.status === 'closed')?.id;

  const q = show === 'upcoming' ? upcomingQ : pastQ;
  const list = show === 'upcoming' ? upcoming : past;

  return (
    <>
      <PageHeader
        title="מפגשים"
        subtitle="מפגשי שישי, ערבי מדורה ופעילויות נוספות"
        actions={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}
      />
      <Tabs
        label="מפגשים"
        value={show}
        onChange={(v) => setParams(v === 'past' ? { show: 'past' } : {}, { replace: true })}
        tabs={[
          { value: 'upcoming', label: 'קרובים', count: upcomingQ.data ? upcoming.length : undefined },
          { value: 'past', label: unclosed ? <span className="flex items-center gap-1.5">קודמים<span className="h-2 w-2 rounded-full bg-warn" aria-label={`${unclosed} לא נסגרו`} /></span> : 'קודמים' },
        ]}
      />

      {q.isLoading ? (
        <Panel><Skeleton lines={6} /></Panel>
      ) : q.isError ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Panel>
          {show === 'upcoming' ? (
            <EmptyState icon="calendar" title="אין מפגשים קרובים" action={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}>
              אפשר ליצור מפגש חדש, או לשכפל את המפגש האחרון מלשונית "קודמים".
            </EmptyState>
          ) : (
            <EmptyState icon="calendar" title="עוד לא התקיימו מפגשים">אחרי כל מפגש יופיעו כאן הנוכחות, החדשים והדירוג.</EmptyState>
          )}
        </Panel>
      ) : show === 'upcoming' ? (
        <UpcomingList events={list} speakers={byId} nextId={nextId} />
      ) : (
        <>
          {unclosed > 0 && (
            <div className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-control)] bg-warn-wash px-3.5 py-3 text-sm text-warn">
              <Icon name="alert" size={18} className="mt-0.5" />
              <span>
                {unclosed === 1 ? 'מפגש אחד הסתיים ולא נסגר.' : `${unclosed} מפגשים הסתיימו ולא נסגרו.`} בסגירה מסומנים מי שלא הגיעו ונוצרות משימות מעקב.
              </span>
            </div>
          )}
          <PastList events={list} now={now} />
          {(pastQ.data?.length ?? 0) >= pastLimit && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" busy={pastQ.isFetching} onClick={() => setPastLimit((n) => n + PAST_PAGE)}>הצגת מפגשים קודמים נוספים</Button>
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

function Capacity({ e }: { e: EventWithStats }) {
  const reg = e.stats?.registered_count ?? 0;
  const full = e.capacity != null && reg >= e.capacity;
  return (
    <span className={cx('num font-semibold', full && 'text-bad')}>
      {reg}
      <span className="font-normal text-muted">/{e.capacity ?? '∞'}</span>
    </span>
  );
}

function WhenCell({ e, highlight }: { e: EventWithStats; highlight?: boolean }) {
  const today = ilParts(e.starts_at).date === todayIl();
  return (
    <div className="flex items-stretch gap-3">
      <span className={cx('w-1 shrink-0 rounded-full', highlight ? 'bg-light' : 'bg-transparent')} aria-hidden="true" />
      <div>
        <div className="font-semibold">{fmtDay(e.starts_at)}, <span className="num">{fmtShortDate(e.starts_at)}</span></div>
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <span className="num">{timeRange(e)}</span>
          {today ? <Badge tone="light">היום</Badge> : highlight ? <span>· {relativeDays(e.starts_at)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function UpcomingList({ events, speakers, nextId }: { events: EventWithStats[]; speakers: Map<string, Speaker>; nextId?: string }) {
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
                  'block rounded-[var(--radius-panel)] border bg-paper p-4 transition-colors hover:border-tide',
                  e.id === nextId ? 'border-light' : 'border-line-soft',
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
                  <div className="mt-1 text-sm text-ink-soft">
                    {sp.name ?? 'מרצה לא נקבע/ה'}{sp.topic ? `: ${sp.topic}` : ''}
                    {sp.pending && <span className="ms-1.5 text-warn">(ממתין לאישור)</span>}
                  </div>
                )}
                <div className="mt-2.5 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5"><Icon name="people" size={16} className="text-muted" />נרשמו <Capacity e={e} /></span>
                  {(e.stats?.waitlisted_count ?? 0) > 0 && <span>בהמתנה <span className="num font-semibold">{e.stats!.waitlisted_count}</span></span>}
                  {e.type === 'friday' && !e.speaker_id && e.status !== 'cancelled' && <Badge tone="warn" icon="mic">בלי מרצה</Badge>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* desktop: table */}
      <div className="hidden overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper md:block">
        <table className="w-full text-[0.95rem]">
          <thead className="border-b border-line-soft bg-mist/60 text-sm text-muted">
            <tr className="text-right">
              <th className="px-4 py-2.5 font-semibold">מתי</th>
              <th className="px-3 py-2.5 font-semibold">מפגש</th>
              <th className="px-3 py-2.5 font-semibold">סטטוס</th>
              <th className="px-3 py-2.5 font-semibold">נרשמו</th>
              <th className="px-3 py-2.5 font-semibold">המתנה</th>
              <th className="px-4 py-2.5 font-semibold">מרצה ונושא</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const sp = speakerText(e, speakers);
              return (
                <tr
                  key={e.id}
                  onClick={() => navigate(`/app/events/${e.id}`)}
                  className={cx('cursor-pointer border-b border-line-soft last:border-0 hover:bg-mist/50', e.status === 'cancelled' && 'text-muted')}
                >
                  <td className="py-3 pr-3 pl-4"><WhenCell e={e} highlight={e.id === nextId} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <TypeBadge type={e.type} />
                      <Link to={`/app/events/${e.id}`} onClick={(ev) => ev.stopPropagation()} className={cx('font-bold hover:text-tide hover:underline', e.status === 'cancelled' && 'line-through')}>
                        {e.title}
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-3 py-3"><Capacity e={e} /></td>
                  <td className="px-3 py-3"><span className="num">{e.stats?.waitlisted_count ? e.stats.waitlisted_count : <span className="text-faint">—</span>}</span></td>
                  <td className="max-w-72 px-4 py-3">
                    {sp.name || sp.topic ? (
                      <div className="leading-snug">
                        <div className="font-medium">
                          {sp.name ?? <span className="text-muted">מרצה לא נקבע/ה</span>}
                          {sp.pending && <span className="ms-1.5 text-sm text-warn">(ממתין לאישור)</span>}
                        </div>
                        {sp.topic && <div className="truncate text-sm text-muted">{sp.topic}</div>}
                      </div>
                    ) : e.type === 'friday' && e.status !== 'cancelled' ? (
                      <Badge tone="warn" icon="mic">בלי מרצה</Badge>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
              <Link to={`/app/events/${e.id}`} className={cx('block rounded-[var(--radius-panel)] border border-line-soft bg-paper p-4 hover:border-tide', e.status === 'cancelled' && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{fmtDay(e.starts_at)}, <span className="num">{fmtShortDate(e.starts_at)}</span> <span className="num text-sm font-normal text-muted">{fmtTime(e.starts_at)}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-2"><TypeBadge type={e.type} /><span className="font-bold">{e.title}</span></div>
                  </div>
                  {isUnclosed(e, now) ? <UnclosedBadge /> : <StatusBadge status={e.status} />}
                </div>
                {e.status !== 'cancelled' && (
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <MiniStat label="הגיעו" value={n.attended} />
                    <MiniStat label="חדשים/חוזרים" value={n.newRet} />
                    <MiniStat label="שיעור הגעה" value={n.show} />
                    <MiniStat label="דירוג" value={n.rating} />
                  </dl>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper md:block">
        <table className="w-full text-[0.95rem]">
          <thead className="border-b border-line-soft bg-mist/60 text-sm text-muted">
            <tr className="text-right">
              <th className="px-4 py-2.5 font-semibold">מתי</th>
              <th className="px-3 py-2.5 font-semibold">מפגש</th>
              <th className="px-3 py-2.5 font-semibold">הגיעו</th>
              <th className="px-3 py-2.5 font-semibold">חדשים / חוזרים</th>
              <th className="px-3 py-2.5 font-semibold" title="מבין מי שנרשם מראש ולא ביטל">שיעור הגעה</th>
              <th className="px-3 py-2.5 font-semibold">דירוג</th>
              <th className="px-4 py-2.5 font-semibold">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const n = pastNumbers(e);
              return (
                <tr key={e.id} onClick={() => navigate(`/app/events/${e.id}`)} className={cx('cursor-pointer border-b border-line-soft last:border-0 hover:bg-mist/50', e.status === 'cancelled' && 'text-muted')}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{fmtDay(e.starts_at)}, <span className="num">{fmtShortDate(e.starts_at)}</span></div>
                    <div className="num text-right text-sm text-muted">{fmtTime(e.starts_at)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <TypeBadge type={e.type} />
                      <Link to={`/app/events/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="font-bold hover:text-tide hover:underline">{e.title}</Link>
                    </div>
                  </td>
                  <td className="num px-3 py-3 text-right font-semibold">{n.attended}</td>
                  <td className="px-3 py-3">{n.newRet}</td>
                  <td className="num px-3 py-3 text-right">{n.show}</td>
                  <td className="px-3 py-3">
                    <span className="num">{n.rating}</span>
                    {n.feedback > 0 && <span className="ms-1 text-sm text-muted">({n.feedback})</span>}
                  </td>
                  <td className="px-4 py-3">{isUnclosed(e, now) ? <UnclosedBadge /> : <StatusBadge status={e.status} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** "new / returning" in reading order (RTL): new on the right, like the column header. */
function NewReturning({ n, r }: { n: number; r: number }) {
  return <span dir="rtl"><span className="num">{n}</span> / <span className="num">{r}</span></span>;
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col-reverse rounded-lg bg-mist px-1 py-1.5">
      <dt className="text-[0.72rem] leading-tight text-muted">{label}</dt>
      <dd className="font-display text-lg leading-tight tabular-nums">{value}</dd>
    </div>
  );
}
