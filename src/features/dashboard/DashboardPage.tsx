import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { useSettings, useSites, type EventWithStats } from '@/lib/data';
import { derived, num, pct, type Kpis } from '@/lib/metrics';
import { fmtDate, fmtDayLong, fmtTime, relativeDays, todayIl, ilParts } from '@/lib/dates';
import { registerUrl } from '@/lib/links';
import { useMe } from '@/lib/auth';
import { Button, ButtonLink, EmptyState, ErrorBox, Notice, PageHeader, Panel, Skeleton, cx } from '@/ui/kit';
import { Dialog, useCopy } from '@/ui/feedback';
import { useConnectionTrouble } from '@/ui/OfflineBar';
import { Icon, type IconName } from '@/ui/Icon';
import { FridayLine, GoalStat, SplitBars } from '@/ui/charts';
import { Stripes, Tri } from '@/ui/Shapes';
import { FilterBar, periodLabel, rpcArgs, useFilters, type Filters } from '@/features/reports/period';
import { Drilldown, type DrillKind } from '@/features/reports/Drilldown';
import { securityAlerts, useSecurityOverview } from '@/features/settings/SecuritySettings';
import { MyWeekPanel } from '@/features/prep/MyWeekPanel';
import { useEventList } from '@/features/events/queries';
import { hasStarted, seats } from '@/features/events/shared';

type Attention = {
  lapsed: { participant_id: string; full_name: string; last_attended_at: string; friday_count: number; fridays_missed: number; has_open_task: boolean }[];
  followups_open: number;
  followups_overdue: number;
  followups_mine: number;
  events_unclosed: { id: string; title: string; starts_at: string }[];
  fridays_without_speaker: { id: string; title: string; starts_at: string }[];
  waitlist_with_space: { id: string; title: string; starts_at: string; waitlisted: number; free: number | null }[];
  drafts_soon: { id: string; title: string; starts_at: string }[];
  proposals_pending: number;
  name_mismatches?: { registration_id: string; event_id: string; event_title: string; starts_at: string; participant_id: string; card_name: string; typed_name: string }[];
  /** Meetings that ended 24 hours ago (up to a week), with thank-you messages not sent yet. */
  aftercare?: { id: string; title: string; starts_at: string; pending: number; join_invites: number }[];
  /** payments from "יש חשבונית" that matched no pending registration */
  unmatched_payments?: number;
};

type SourceRow = { source_id: string | null; label: string; is_friend: boolean; participants: number; returned: number; registered_only: number };

export function DashboardPage() {
  const me = useMe();
  const settings = useSettings();
  const [filters, set] = useFilters({ period: '90d' });
  const [drill, setDrill] = useState<DrillKind | null>(null);
  const copy = useCopy();

  const kpis = useQuery({
    queryKey: ['kpis', filters],
    queryFn: async () => must(await supabase.rpc('report_kpis', rpcArgs(filters))) as Kpis,
  });
  const attention = useQuery({
    queryKey: ['attention'],
    queryFn: async () => must(await supabase.rpc('attention_items')) as Attention,
  });
  const sources = useQuery({
    queryKey: ['report_sources', filters.from, filters.to],
    queryFn: async () => must(await supabase.rpc('report_sources', { p_from: filters.from, p_to: filters.to })) as SourceRow[],
  });
  // one "now" per visit keeps the query keys stable. The next meeting and the line are fetched on their own:
  // "every meeting of the last 120 days, oldest first" stops at the API's 1000-row cap and missed today's meeting.
  const [now] = useState(() => Date.now());
  const nowIso = useMemo(() => new Date(now).toISOString(), [now]);
  const upcomingQ = useEventList({ endsAfter: nowIso, notStatuses: ['cancelled'], ascending: true, limit: 12 });
  const pastQ = useEventList({ endsBefore: nowIso, notStatuses: ['cancelled', 'draft'], ascending: false, limit: 60 });
  const loadingEvents = upcomingQ.isLoading || pastQ.isLoading;

  const upcoming = (upcomingQ.data ?? []).filter((e) => new Date(e.ends_at).getTime() > Date.now());
  const next = upcoming[0];
  const nextOpen = upcoming.find((e) => e.status === 'open') ?? next;
  // the line shows closed meetings only: their attendance is final
  const past = (pastQ.data ?? []).filter((e) => e.status === 'completed' && (!filters.type || e.type === filters.type)).slice(0, 9).reverse();
  /** the meeting "שכפול המפגש האחרון" copies: the latest one that took place */
  const last = (pastQ.data ?? [])[0];
  const nextIsToday = !!next && (ilParts(next.starts_at).date === todayIl() || hasStarted(next));

  const d = kpis.data ? derived(kpis.data) : null;
  const g = kpis.data?.goals;
  const firstRun = upcomingQ.data && pastQ.data && upcomingQ.data.length === 0 && pastQ.data.length === 0;
  const unclosed = kpis.data?.unclosed_events ?? attention.data?.events_unclosed.length ?? 0;
  // one page error with one retry, instead of an error in every panel; with no connection the offline bar says it
  const failed = [kpis, attention, sources, upcomingQ, pastQ].filter((q) => q.isError && !q.data);
  const trouble = useConnectionTrouble();
  const retryFailed = () => failed.forEach((q) => void q.refetch());
  const notLoaded = <p className="text-small text-muted">לא נטען.</p>;
  const hour = Number(ilParts(new Date()).time.slice(0, 2));
  const hello = hour < 12 ? 'בוקר טוב' : hour < 18 ? 'צהריים טובים' : 'ערב טוב';

  return (
    <>
      <PageHeader
        title={`${hello}${me.data ? `, ${me.data.full_name.split(' ')[0]}` : ''}`}
        subtitle="מה קורה במפגשים, איך אנחנו מול היעדים, ומה דורש טיפול."
        actions={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}
      />
      {me.data?.role === 'admin' && <SecurityAlert />}
      {failed.length > 0 && !trouble && (
        <div className="mb-5">
          <ErrorBox error={`חלק מהנתונים במסך לא נטענו. ${errorMessage(failed[0].error)}`} onRetry={retryFailed} />
        </div>
      )}

      {firstRun ? (
        <Panel>
          <EmptyState icon="sun" title="עוד אין מפגשים במערכת" action={<ButtonLink to="/app/events/new" icon="plus" size="lg">יצירת מפגש השישי הראשון</ButtonLink>}>
            <ol className="mt-3 list-inside list-decimal space-y-1 text-right">
              <li>יוצרים את מפגש השישי הקרוב ופותחים הרשמה.</li>
              <li>משתפים את קישור ההרשמה באינסטגרם ובקבוצות הוואטסאפ.</li>
              <li>ביום שישי תולים את הברקוד בכניסה, והלוחמים מסמנים הגעה בעצמם.</li>
            </ol>
          </EmptyState>
        </Panel>
      ) : (
        <>
          {/* a meeting today is the day's work: it leads the page. Otherwise the page opens with how we are doing
              (the goals) and what needs doing (attention, my week), and the next meeting follows. */}
          {nextIsToday && <NextMeeting next={next} nextOpen={nextOpen} last={last} loading={loadingEvents} className="mb-6" onCopy={(url) => copy(url, 'קישור ההרשמה הועתק')} />}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-section font-bold">מול היעדים</h2>
            {/* a phone gets one chip that names the active filters and opens them; wider screens show the bar */}
            <div className="max-sm:hidden"><FilterBar filters={filters} set={set} /></div>
            <FilterChip filters={filters} set={set} />
          </div>
          {kpis.error && !kpis.data ? <div className="mb-6">{notLoaded}</div> : (
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {!kpis.data || !d || !g ? Array.from({ length: 5 }).map((_, i) => <div key={i} role="status" aria-label="בטעינה…" className={cx('skeleton h-[9.5rem] rounded-[var(--radius-panel)] sm:h-[11.25rem]', i === 4 && 'col-span-2 lg:col-span-1')} />) : (
                <>
                  <GoalStat label="ממוצע לוחמים למפגש" value={d.avgAttendance} display={num(d.avgAttendance, 1)} goal={g.avg_attendance} goalDisplay={num(g.avg_attendance)}
                    hint={kpis.data.events === 1 ? `${kpis.data.attendances} הגעות במפגש אחד` : `${kpis.data.attendances} הגעות ב־${kpis.data.events} מפגשים`} onOpen={() => setDrill('attendees')} />
                  <GoalStat label="שיעור הגעה" value={d.showRate} display={pct(d.showRate)} goal={g.show_rate} goalDisplay={pct(g.show_rate)}
                    hint={`${kpis.data.preregistered_attended} מתוך ${kpis.data.preregistered} רשומים`} />
                  <GoalStat label="הגיעו ליותר ממפגש אחד" value={d.returnRate} display={pct(d.returnRate)} goal={g.return_rate} goalDisplay={pct(g.return_rate)}
                    hint={`${kpis.data.returning_attendees} מתוך ${kpis.data.unique_attendees} לוחמים`} onOpen={() => setDrill('returning')} />
                  <GoalStat label="חדשים שהגיעו דרך חבר" value={d.friendShare} display={pct(d.friendShare)} goal={g.friend_share} goalDisplay={pct(g.friend_share)}
                    hint={`${kpis.data.friend_new} מתוך ${kpis.data.new_attendees} חדשים`} onOpen={() => setDrill('friend_new')} />
                  <GoalStat className="col-span-2 lg:col-span-1" label="דירוג ממוצע למפגש" value={d.avgRating} display={num(d.avgRating, 1)} goal={g.avg_rating} goalDisplay={num(g.avg_rating, 1)}
                    hint={kpis.data.feedback_count ? `${kpis.data.feedback_count} משובים` : 'עוד אין משובים'} />
                </>
              )}
            </div>
          )}
          {/* under the tiles, not above them: it appears with the numbers and must not push them down (CLS) */}
          {kpis.data && (unclosed > 0 || kpis.data.events === 0) && (
            <div className="mb-3">
              <Notice tone="light" icon="alert">
                <span className="font-semibold">המספרים מתעדכנים רק אחרי סגירת מפגש</span>
                {unclosed > 0 ? (
                  <>
                    {' · '}
                    <Link to={`/app/events?show=past&status=unclosed${filters.type ? `&type=${filters.type}` : ''}`} className="inline-flex items-center font-bold text-ink underline underline-offset-2">
                      {unclosed === 1 ? 'מפגש אחד בתקופה הזו מחכה לסגירה' : <><span className="num">{unclosed}</span>&nbsp;מפגשים בתקופה הזו מחכים לסגירה</>}<Tri className="ms-1.5" />
                    </Link>
                  </>
                ) : <span className="text-ink-soft"> · בתקופה הזו עוד לא נסגר מפגש, ולכן מופיע "—".</span>}
              </Notice>
            </div>
          )}
          {kpis.data ? (
            <p className="mb-6 text-small text-muted">
              בתקופה, במפגשים שנסגרו: <button type="button" className="inline-flex min-h-11 items-center font-semibold text-tide hover:underline sm:min-h-0" onClick={() => setDrill('new')}>{kpis.data.new_attendees} לוחמים חדשים</button>
              {' · '}{kpis.data.walk_ins} הגיעו בלי הרשמה · {kpis.data.cancelled} ביטולים
              {kpis.data.attendances > 0 && <> · {pct(d?.selfCheckinShare ?? null)} עשו צ׳ק־אין עצמי</>}
            </p>
          ) : kpis.isLoading ? <div className="mb-6 h-11 sm:h-5" aria-hidden="true" /> : null}

          <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
            <Panel title="דורש תשומת לב">
              {attention.isLoading ? <Skeleton shape="rows" count={4} height={56} className="border-0" /> : !attention.data ? notLoaded : (
                <AttentionList a={attention.data!} />
              )}
            </Panel>
            <div className="flex flex-col gap-6">
              <MyWeekPanel />
              <Panel
                title="מאיפה מגיעים, ומי חוזר"
                description={unclosed > 0 ? 'כולל מפגשים שעוד לא נסגרו' : undefined}
                actions={<Link to="/app/reports?tab=sources" className="-my-2 inline-flex min-h-11 items-center text-small font-semibold text-tide hover:underline">לדוח המלא</Link>}
              >
                {sources.isLoading ? <Skeleton shape="block" height={160} /> : !sources.data ? notLoaded : !sources.data.some((s) => s.participants > 0) ? (
                  <p className="text-muted">כשלוחמים חדשים יגיעו למפגשים, יופיע כאן מאיזה מקור הם הגיעו וכמה מהם חזרו.</p>
                ) : (
                  <SplitBars
                    totalLabel="הגיעו פעם אחת"
                    partLabel="חזרו"
                    rows={sources.data.filter((s) => s.participants > 0).map((s) => ({ key: s.source_id ?? 'none', label: s.label, total: s.participants, part: s.returned }))}
                  />
                )}
              </Panel>
            </div>
          </div>

          {!nextIsToday && <NextMeeting next={next} nextOpen={nextOpen} last={last} loading={loadingEvents} className="mb-6" onCopy={(url) => copy(url, 'קישור ההרשמה הועתק')} />}

          <Panel title="קו השישי" className="mb-6" description="כל נקודה היא מפגש שנסגר. לחיצה פותחת את הסיכום שלו.">
            {loadingEvents ? <Skeleton shape="block" height={220} /> : !pastQ.data && pastQ.isError ? notLoaded : past.length === 0 && !next ? (
              <p className="text-muted">הקו יתחיל להתמלא אחרי המפגש הראשון שנסגר.</p>
            ) : (
              <FridayLine
                goal={filters.type === 'friday' ? settings.data?.goal_avg_attendance : null}
                stations={past.map((e) => ({ id: e.id, starts_at: e.starts_at, title: e.title, attended: e.stats?.attended_count ?? 0, new_count: e.stats?.new_count ?? 0, returning_count: e.stats?.returning_count ?? 0 }))}
                next={next && (!filters.type || next.type === filters.type) ? { id: next.id, starts_at: next.starts_at, registered: seats(next).taken, capacity: next.capacity } : null}
              />
            )}
          </Panel>
        </>
      )}
      <Drilldown kind={drill} filters={filters} onClose={() => setDrill(null)} />
    </>
  );
}

/**
 * The next meeting: a navy panel, the beige date as the one highlight on the page; a short run of stripes enters from
 * the top edge and stays a full unit clear of the text (book p.42). Today it offers the door; otherwise the link.
 */
function NextMeeting({ next, nextOpen, last, loading, className, onCopy }: {
  next: EventWithStats | undefined; nextOpen: EventWithStats | undefined; last: EventWithStats | undefined; loading: boolean; className?: string;
  onCopy: (url: string) => void;
}) {
  if (loading) return <div role="status" aria-label="בטעינה…" className={cx('skeleton h-[15rem] rounded-[var(--radius-panel)] sm:h-[8.5rem]', className)} />;
  if (!next) {
    return (
      <Panel className={className}>
        <EmptyState
          icon="calendar"
          title="אין מפגש קרוב בלוח"
          action={last
            ? <ButtonLink to={`/app/events/${last.id}?dup=1`} icon="copy">שכפול המפגש האחרון</ButtonLink>
            : <ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}
        >
          כדאי לפתוח את השישי הבא שבוע מראש, כדי שיהיה זמן לפרסם.{last && <> המפגש האחרון: {last.title}, <span className="num">{fmtDate(last.starts_at)}</span>.</>}
        </EmptyState>
      </Panel>
    );
  }
  const st = seats(next);
  const today = ilParts(next.starts_at).date === todayIl();
  const live = hasStarted(next);
  return (
    <section aria-label="המפגש הבא" className={cx('relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-light', className)}>
      {/* two whole stripes that enter from the top edge and are cut by a horizontal line (desktop only: on a
          phone the header right above already carries the brand's run) */}
      <Stripes width={100} height={48} unit={12} dir="fall" count={2} offset={48} className="absolute top-0 left-0 hidden h-12 w-[100px] text-light sm:block" />
      <div className="relative flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6 sm:pl-32">
        <div className="flex min-w-0 items-center gap-4">
          <div className="shrink-0 rounded-[var(--radius-control)] bg-light px-3.5 py-2 text-center text-ink">
            <div className="text-micro font-semibold">{live ? 'עכשיו' : relativeDays(next.starts_at)}</div>
            <div className="num text-section font-bold">{fmtDate(next.starts_at).slice(0, 5)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-small text-light/75">{live ? 'המפגש מתקיים עכשיו' : 'המפגש הבא'}</div>
            <Link to={`/app/events/${next.id}`} className="text-section font-bold hover:underline">{next.title}</Link>
            <div className="text-small text-light/80">{fmtDayLong(next.starts_at)} · <span className="num">{fmtTime(next.starts_at)}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          {live && (
            <div>
              <div className="num font-display text-stat text-light">{next.stats?.attended_count ?? 0}</div>
              <div className="text-small text-light/75">הגיעו</div>
            </div>
          )}
          <div>
            <div className="num font-display text-stat text-light">
              {st.taken}{st.capacity != null ? <span className="text-section text-light/60">/{st.capacity}</span> : null}
            </div>
            <div className="text-small text-light/75">{st.walkIns ? `${st.registered} רשומים · ${st.walkIns} בלי הרשמה` : 'רשומים'}</div>
          </div>
          {st.waitlisted > 0 && (
            <div>
              <div className="num font-display text-stat">{st.waitlisted}</div>
              <div className="text-small text-light/75">ברשימת ההמתנה</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {today && next.status !== 'draft' ? (
              <>
                <ButtonLink to={`/app/events/${next.id}/door`} variant="light" icon="door" cta>מצב כניסה</ButtonLink>
                <ButtonLink to={`/app/events/${next.id}`} variant="onDark">ניהול המפגש</ButtonLink>
              </>
            ) : (
              <ButtonLink to={`/app/events/${next.id}`} variant="light" cta>ניהול המפגש</ButtonLink>
            )}
            {!today && nextOpen?.status === 'open' && (
              <Button variant="onDark" icon="copy" onClick={() => onCopy(registerUrl(nextOpen.public_code))}>העתקת קישור ההרשמה</Button>
            )}
          </div>
        </div>
      </div>
      {next.status === 'draft' && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-light px-5 py-2.5 text-small font-medium text-ink">
          <Icon name="alert" size={16} />המפגש עדיין טיוטה, וההרשמה אליו לא פתוחה.
          <Link to={`/app/events/${next.id}`} className="inline-flex min-h-11 items-center font-bold underline">לפתיחת הרשמה</Link>
        </div>
      )}
    </section>
  );
}

function AttentionList({ a }: { a: Attention }) {
  const items: { icon: IconName; tone: 'bad' | 'warn' | 'tide'; text: React.ReactNode; to: string; action: string }[] = [];
  // each category stays short: at most two concrete lines, then one summary line
  const capped = <T,>(list: T[], one: (e: T) => (typeof items)[number], many: (n: number) => (typeof items)[number]) => {
    if (list.length > 2) items.push(many(list.length));
    else list.forEach((e) => items.push(one(e)));
  };
  capped(a.events_unclosed,
    (e) => ({ icon: 'alert', tone: 'bad', text: <>המפגש מ־<span className="num">{fmtDate(e.starts_at)}</span> הסתיים ולא נסגר. בלי סגירה, מי שלא הגיע לא מקבל מעקב.</>, to: `/app/events/${e.id}?close=1`, action: 'לסגירה' }),
    (n) => ({ icon: 'alert', tone: 'bad', text: <><span className="num font-bold">{n}</span> מפגשים הסתיימו ולא נסגרו. בלי סגירה, מי שלא הגיע לא מקבל מעקב.</>, to: '/app/events?show=past&status=unclosed', action: 'לרשימה' }));
  capped(a.aftercare ?? [],
    (e) => ({ icon: 'message', tone: 'warn', text: <>{e.title} (<span className="num">{fmtDate(e.starts_at)}</span>) הסתיים לפני יותר מיממה: <span className="num font-bold">{e.pending}</span> הודעות תודה מחכות לשליחה{e.join_invites > 0 && <>, מהן <span className="num">{e.join_invites}</span> עם הזמנה להצטרף לעמותה</>}</>, to: `/app/events/${e.id}?tab=messages&group=aftercare`, action: 'לשליחה' }),
    (n) => ({ icon: 'message', tone: 'warn', text: <>ב־<span className="num font-bold">{n}</span> מפגשים מהשבוע האחרון עוד לא נשלחו הודעות תודה</>, to: `/app/events/${a.aftercare![0].id}?tab=messages&group=aftercare`, action: 'למפגש הראשון' }));
  if (a.followups_overdue) items.push({ icon: 'task', tone: 'bad', text: <><span className="num font-bold">{a.followups_overdue}</span> משימות מעקב באיחור</>, to: '/app/followups?tab=open', action: 'למשימות' });
  const lapsedNoTask = a.lapsed.filter((l) => !l.has_open_task);
  if (lapsedNoTask.length) items.push({ icon: 'people', tone: 'warn', text: <><span className="num font-bold">{lapsedNoTask.length}</span> קבועים הפסיקו להגיע: {lapsedNoTask.slice(0, 3).map((l) => l.full_name).join(', ')}{lapsedNoTask.length > 3 ? ' ועוד' : ''}</>, to: '/app/followups?tab=open', action: 'לבדיקה' });
  capped(a.waitlist_with_space,
    (e) => ({ icon: 'userPlus', tone: 'warn', text: <>התפנו מקומות ב{e.title} (<span className="num">{fmtDate(e.starts_at)}</span>) ויש <span className="num">{e.waitlisted}</span> ברשימת ההמתנה</>, to: `/app/events/${e.id}?tab=registrations`, action: 'לקידום' }),
    (n) => ({ icon: 'userPlus', tone: 'warn', text: <>ב־<span className="num font-bold">{n}</span> מפגשים התפנו מקומות ויש לוחמים ברשימת ההמתנה</>, to: '/app/events?status=waitlist', action: 'למפגשים' }));
  capped(a.fridays_without_speaker,
    (e) => ({ icon: 'mic', tone: 'tide', text: <>אין מרצה מאושר לשישי <span className="num">{fmtDate(e.starts_at)}</span> ({relativeDays(e.starts_at)})</>, to: `/app/events/${e.id}/edit`, action: 'לשיבוץ' }),
    (n) => ({ icon: 'mic', tone: 'tide', text: <><span className="num font-bold">{n}</span> מפגשי שישי בחמשת השבועות הקרובים עדיין בלי מרצה מאושר</>, to: '/app/events?status=nospeaker', action: 'למפגשים' }));
  capped(a.drafts_soon,
    (e) => ({ icon: 'calendar', tone: 'tide', text: <>{e.title} ב־<span className="num">{fmtDate(e.starts_at)}</span> עדיין טיוטה</>, to: `/app/events/${e.id}`, action: 'לפתיחה' }),
    (n) => ({ icon: 'calendar', tone: 'tide', text: <><span className="num font-bold">{n}</span> מפגשים בשבוע הקרוב עדיין טיוטה, וההרשמה אליהם סגורה</>, to: '/app/events?status=draft', action: 'למפגשים' }));
  const mism = a.name_mismatches ?? [];
  capped(mism,
    (m) => ({ icon: 'alert', tone: 'warn', text: <>הרשמה בשם "{m.typed_name}" עם הטלפון של {m.card_name}. ייתכן שהוקלד מספר שגוי.</>, to: `/app/events/${m.event_id}?tab=registrations`, action: 'לבירור' }),
    (n) => ({ icon: 'alert', tone: 'warn', text: <><span className="num font-bold">{n}</span> הרשמות בשם שונה מהשם בכרטיס (ייתכן מספר טלפון שגוי)</>, to: `/app/events/${mism[0].event_id}?tab=registrations`, action: 'לבירור הראשונה' }));
  if (a.unmatched_payments) items.push({ icon: 'alert', tone: 'warn', text: <><span className="num font-bold">{a.unmatched_payments}</span> תשלומים מ"יש חשבונית" לא זוהו ומחכים להתאמה להרשמה</>, to: '/app/reports?tab=finance', action: 'להתאמה' });
  if (a.proposals_pending) items.push({ icon: 'mic', tone: 'tide', text: <><span className="num font-bold">{a.proposals_pending}</span> הצעות להרצאה או הדרכה מחכות לאישור</>, to: '/app/speakers?tab=proposed', action: 'לצפייה' });
  if (a.followups_mine) items.push({ icon: 'task', tone: 'tide', text: <><span className="num font-bold">{a.followups_mine}</span> משימות פתוחות משויכות אליך</>, to: '/app/followups', action: 'למשימות שלי' });

  if (!items.length) {
    return <EmptyState icon="checkCircle" title="הכול מטופל">אין מפגשים שמחכים לסגירה, משימות באיחור או קבועים שהפסיקו להגיע.</EmptyState>;
  }
  // G4: the urgent first, then what needs doing soon, then the rest. Red appears once, as the urgent group's
  // header; the rows themselves carry only a tinted glyph (warning wash for "soon", a quiet tint for the rest)
  const rank = { bad: 0, warn: 1, tide: 2 } as const;
  const sorted = items.map((it, i) => ({ ...it, i })).sort((x, y) => rank[x.tone] - rank[y.tone] || x.i - y.i);
  const urgent = sorted.filter((it) => it.tone === 'bad').length;
  const toneCls = { bad: 'bg-bad-wash text-bad', warn: 'bg-warn-wash text-warn', tide: 'bg-ink/[0.07] text-ink-soft' };
  return (
    <ul className="flex flex-col divide-y divide-edge">
      {urgent > 0 && (
        <li className="flex items-center gap-2 pb-2 text-small font-bold text-bad">
          <Icon name="alert" size={16} />
          {urgent === 1 ? 'דחוף: דבר אחד' : <>דחוף: <span className="num">{urgent}</span> דברים</>}
        </li>
      )}
      {sorted.map((it) => (
        <li key={it.i} className={cx('flex items-start gap-3 py-2.5 last:pb-0', urgent === 0 && 'first:pt-0')}>
          <span className={`mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${toneCls[it.tone]}`}><Icon name={it.icon} size={17} /></span>
          <span className="flex-1 py-2 text-body leading-snug">{it.text}</span>
          <Link to={it.to} className="-mx-2 inline-flex min-h-11 shrink-0 items-center px-2 text-small font-semibold text-tide hover:underline">{it.action}</Link>
        </li>
      ))}
      {a.followups_open > 0 && <li className="pt-3 text-small text-muted">בסך הכול <span className="num font-semibold text-ink">{a.followups_open}</span> משימות מעקב פתוחות</li>}
    </ul>
  );
}

/** Admins only: unknown accounts (open sign-up) or staff sign-in lockouts / invite-link probing in the last 24 hours. */
function SecurityAlert() {
  const q = useSecurityOverview();
  const n = securityAlerts(q.data);
  if (!n) return null;
  return (
    <div className="mb-5">
      <Notice tone="warn" icon="alert">
        יש {n === 1 ? 'התראת אבטחה אחת' : <><span className="num">{n}</span> התראות אבטחה</>} לבדיקה: חשבונות שלא שייכים לצוות, או חסימות בכניסת הצוות.{' '}
        <Link to="/app/settings?tab=security" className="font-semibold underline">למסך האבטחה</Link>
      </Notice>
    </div>
  );
}

const PERIOD_WORD: Partial<Record<Filters['period'], string>> = {
  month: 'החודש', prev_month: 'החודש הקודם', '30d': '30 יום', '90d': '3 חודשים', year: 'השנה', all: 'הכול',
};
const TYPE_WORD: Record<string, string> = { friday: 'שישי', bonfire: 'מדורה' };

/**
 * Phones: the filters as one chip that names what is on ("3 חודשים · שישי"), opening the full filter bar in a dialog.
 * The choice applies at once (as on the wide bar); "הצגה" closes the dialog.
 */
function FilterChip({ filters, set }: { filters: Filters; set: (p: Partial<Record<string, string | null>>) => void }) {
  const [open, setOpen] = useState(false);
  const sites = useSites();
  const site = filters.site ? sites.data?.find((x) => x.id === filters.site)?.name : null;
  const parts = [
    PERIOD_WORD[filters.period] ?? periodLabel(filters),
    filters.type ? TYPE_WORD[filters.type] ?? 'מפגש אחר' : 'כל הפעילויות',
    site,
  ].filter(Boolean);
  return (
    <div className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`סינון: ${parts.join(', ')}`}
        className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-control-line bg-paper px-3 text-small font-semibold text-ink hover:border-ink"
      >
        <Icon name="filter" size={16} />
        {parts.join(' · ')}
        <Icon name="chevron" size={14} className="text-muted" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="סינון המספרים" layout="sheet"
        footer={<Button onClick={() => setOpen(false)}>הצגה</Button>}>
        <FilterBar filters={filters} set={set} />
      </Dialog>
    </div>
  );
}
