import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { useEventsWithStats, useSettings } from '@/lib/data';
import { derived, num, pct, type Kpis } from '@/lib/metrics';
import { fmtDate, fmtDayLong, fmtTime, relativeDays, todayIl, ilParts } from '@/lib/dates';
import { registerUrl } from '@/lib/links';
import { useMe } from '@/lib/auth';
import { Badge, Button, ButtonLink, EmptyState, ErrorBox, PageHeader, Panel, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { Icon, type IconName } from '@/ui/Icon';
import { FridayLine, GoalStat, SplitBars } from '@/ui/charts';
import { FilterBar, rpcArgs, useFilters } from '@/features/reports/period';
import { Drilldown, type DrillKind } from '@/features/reports/Drilldown';

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
  const since = useMemo(() => new Date(Date.now() - 120 * 864e5).toISOString(), []);
  const events = useEventsWithStats({ from: since, ascending: true });

  const now = Date.now();
  const list = (events.data ?? []).filter((e) => e.status !== 'cancelled' && e.status !== 'draft' && (!filters.type || e.type === filters.type));
  // the line shows closed meetings only: their attendance is final
  const past = list.filter((e) => e.status === 'completed' && new Date(e.starts_at).getTime() < now).slice(-9);
  const upcoming = (events.data ?? []).filter((e) => e.status !== 'cancelled' && new Date(e.ends_at).getTime() > now);
  const next = upcoming[0];
  const nextOpen = upcoming.find((e) => e.status === 'open') ?? next;

  const d = kpis.data ? derived(kpis.data) : null;
  const g = kpis.data?.goals;
  const firstRun = events.data && events.data.length === 0;
  const hour = Number(ilParts(new Date()).time.slice(0, 2));
  const hello = hour < 12 ? 'בוקר טוב' : hour < 18 ? 'צהריים טובים' : 'ערב טוב';

  return (
    <>
      <PageHeader
        title={`${hello}${me.data ? `, ${me.data.full_name.split(' ')[0]}` : ''}`}
        subtitle="מה קורה במפגשים, מול היעדים לשנה, ומה דורש טיפול."
        actions={<ButtonLink to="/app/events/new" icon="plus">מפגש חדש</ButtonLink>}
      />

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
          {/* the next meeting: the one saffron moment on the page */}
          {events.isLoading ? <Skeleton lines={3} className="mb-6" /> : next ? (
            <section className="mb-6 overflow-hidden rounded-[var(--radius-panel)] bg-ink text-mist">
              <div className="flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-[var(--radius-control)] bg-light px-3.5 py-2 text-center text-ink">
                    <div className="text-xs font-bold">{relativeDays(next.starts_at)}</div>
                    <div className="num font-display text-2xl leading-tight">{fmtDate(next.starts_at).slice(0, 5)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-mist/70">המפגש הבא</div>
                    <Link to={`/app/events/${next.id}`} className="font-display text-xl hover:underline">{next.title}</Link>
                    <div className="text-sm text-mist/80">{fmtDayLong(next.starts_at)} · <span className="num">{fmtTime(next.starts_at)}</span></div>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-6">
                  <div>
                    <div className="num font-display text-[2.4rem] leading-none text-light">
                      {next.stats?.registered_count ?? 0}{next.capacity ? <span className="text-xl text-mist/60">/{next.capacity}</span> : null}
                    </div>
                    <div className="text-sm text-mist/70">נרשמו</div>
                  </div>
                  {(next.stats?.waitlisted_count ?? 0) > 0 && (
                    <div>
                      <div className="num font-display text-[2rem] leading-none">{next.stats!.waitlisted_count}</div>
                      <div className="text-sm text-mist/70">בהמתנה</div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink to={`/app/events/${next.id}`} variant="light">ניהול המפגש</ButtonLink>
                    {ilParts(next.starts_at).date === todayIl() && <ButtonLink to={`/app/events/${next.id}/door`} variant="secondary" icon="door">מצב כניסה</ButtonLink>}
                    {nextOpen?.status === 'open' && (
                      <Button variant="ghost" className="text-mist! hover:bg-white/10" icon="copy" onClick={() => copy(registerUrl(nextOpen.public_code), 'קישור ההרשמה הועתק')}>קישור הרשמה</Button>
                    )}
                  </div>
                </div>
              </div>
              {next.status === 'draft' && (
                <div className="flex items-center gap-2 bg-light-wash px-5 py-2.5 text-sm font-medium text-ink">
                  <Icon name="alert" size={16} />המפגש עדיין טיוטה, וההרשמה אליו לא פתוחה.
                  <Link to={`/app/events/${next.id}`} className="font-bold underline">לפתיחת הרשמה</Link>
                </div>
              )}
            </section>
          ) : (
            <Panel className="mb-6">
              <EmptyState icon="calendar" title="אין מפגש קרוב בלוח" action={<ButtonLink to="/app/events" icon="plus">שכפול המפגש האחרון</ButtonLink>}>
                כדאי לפתוח את השישי הבא שבוע מראש, כדי שיהיה זמן לפרסם.
              </EmptyState>
            </Panel>
          )}

          <Panel title="קו השישי" className="mb-6" actions={<span className="text-sm text-muted">כל נקודה היא מפגש. לחיצה פותחת את הסיכום שלו.</span>}>
            {events.isLoading ? <Skeleton lines={4} /> : past.length === 0 && !next ? (
              <p className="text-muted">הקו יתחיל להתמלא אחרי המפגש הראשון שמתקיים.</p>
            ) : (
              <FridayLine
                goal={filters.type === 'friday' ? settings.data?.goal_avg_attendance : null}
                stations={past.map((e) => ({ id: e.id, starts_at: e.starts_at, title: e.title, attended: e.stats?.attended_count ?? 0, new_count: e.stats?.new_count ?? 0, returning_count: e.stats?.returning_count ?? 0 }))}
                next={next && (!filters.type || next.type === filters.type) ? { id: next.id, starts_at: next.starts_at, registered: next.stats?.registered_count ?? 0, capacity: next.capacity } : null}
              />
            )}
          </Panel>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">היעדים לשנה</h2>
            <FilterBar filters={filters} set={set} />
          </div>
          {kpis.error ? <ErrorBox error={errorMessage(kpis.error)} onRetry={() => kpis.refetch()} /> : (
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {!kpis.data || !d || !g ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-40" />) : (
                <>
                  <GoalStat label="ממוצע משתתפים למפגש" value={d.avgAttendance} display={num(d.avgAttendance, 1)} goal={g.avg_attendance} goalDisplay={num(g.avg_attendance)}
                    hint={`${kpis.data.attendances} הגעות ב-${kpis.data.events} מפגשים`} onOpen={() => setDrill('attendees')} />
                  <GoalStat label="הגיעו מתוך מי שנרשם" value={d.showRate} display={pct(d.showRate)} goal={g.show_rate} goalDisplay={pct(g.show_rate)}
                    hint={`${kpis.data.preregistered_attended} מתוך ${kpis.data.preregistered} נרשמים`} />
                  <GoalStat label="הגיעו ליותר ממפגש אחד" value={d.returnRate} display={pct(d.returnRate)} goal={g.return_rate} goalDisplay={pct(g.return_rate)}
                    hint={`${kpis.data.returning_attendees} מתוך ${kpis.data.unique_attendees} לוחמים`} onOpen={() => setDrill('returning')} />
                  <GoalStat label="חדשים שהגיעו דרך חבר" value={d.friendShare} display={pct(d.friendShare)} goal={g.friend_share} goalDisplay={pct(g.friend_share)}
                    hint={`${kpis.data.friend_new} מתוך ${kpis.data.new_attendees} חדשים`} onOpen={() => setDrill('friend_new')} />
                  <GoalStat label="דירוג ממוצע למפגש" value={d.avgRating} display={num(d.avgRating, 1)} goal={g.avg_rating} goalDisplay={num(g.avg_rating, 1)}
                    hint={kpis.data.feedback_count ? `${kpis.data.feedback_count} משובים` : 'עוד אין משובים'} />
                </>
              )}
            </div>
          )}
          {kpis.data && (
            <p className="-mt-3 mb-6 text-sm text-muted">
              בתקופה: <button type="button" className="font-semibold text-tide hover:underline" onClick={() => setDrill('new')}>{kpis.data.new_attendees} לוחמים חדשים</button>
              {' · '}{kpis.data.walk_ins} הגיעו בלי הרשמה · {kpis.data.cancelled} ביטולים
              {kpis.data.attendances > 0 && <> · {pct(d?.selfCheckinShare ?? null)} עשו צ׳ק־אין עצמי</>}
              {(kpis.data.unclosed_events ?? 0) > 0 && <span className="font-semibold text-warn"> · {kpis.data.unclosed_events} מפגשים שהסתיימו ולא נסגרו לא נכללים במספרים</span>}
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="דורש תשומת לב">
              {attention.isLoading ? <Skeleton lines={4} /> : attention.error ? <ErrorBox error={errorMessage(attention.error)} /> : (
                <AttentionList a={attention.data!} />
              )}
            </Panel>
            <Panel title="מאיפה מגיעים, ומי חוזר" actions={<Link to="/app/reports?tab=sources" className="text-sm font-semibold text-tide hover:underline">לדוח המלא</Link>}>
              {sources.isLoading ? <Skeleton lines={4} /> : sources.error ? <ErrorBox error={errorMessage(sources.error)} /> : !sources.data?.some((s) => s.participants > 0) ? (
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
        </>
      )}
      <Drilldown kind={drill} filters={filters} onClose={() => setDrill(null)} />
    </>
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
    (e) => ({ icon: 'alert', tone: 'bad', text: <>המפגש מ-<span className="num">{fmtDate(e.starts_at)}</span> הסתיים ולא נסגר. בלי סגירה, מי שלא הגיע לא מקבל מעקב.</>, to: `/app/events/${e.id}`, action: 'לסגירה' }),
    (n) => ({ icon: 'alert', tone: 'bad', text: <><span className="num font-bold">{n}</span> מפגשים הסתיימו ולא נסגרו. בלי סגירה, מי שלא הגיע לא מקבל מעקב.</>, to: '/app/events?tab=past', action: 'לרשימה' }));
  if (a.followups_overdue) items.push({ icon: 'task', tone: 'bad', text: <><span className="num font-bold">{a.followups_overdue}</span> משימות מעקב באיחור</>, to: '/app/followups?tab=open', action: 'למשימות' });
  const lapsedNoTask = a.lapsed.filter((l) => !l.has_open_task);
  if (lapsedNoTask.length) items.push({ icon: 'people', tone: 'warn', text: <><span className="num font-bold">{lapsedNoTask.length}</span> קבועים הפסיקו להגיע: {lapsedNoTask.slice(0, 3).map((l) => l.full_name).join(', ')}{lapsedNoTask.length > 3 ? ' ועוד' : ''}</>, to: '/app/followups?tab=open', action: 'לבדיקה' });
  capped(a.waitlist_with_space,
    (e) => ({ icon: 'userPlus', tone: 'warn', text: <>התפנו מקומות ב{e.title} (<span className="num">{fmtDate(e.starts_at)}</span>) ויש <span className="num">{e.waitlisted}</span> בהמתנה</>, to: `/app/events/${e.id}?tab=registrations`, action: 'לקידום' }),
    (n) => ({ icon: 'userPlus', tone: 'warn', text: <>ב-<span className="num font-bold">{n}</span> מפגשים התפנו מקומות ויש ממתינים</>, to: '/app/events', action: 'למפגשים' }));
  capped(a.fridays_without_speaker,
    (e) => ({ icon: 'mic', tone: 'tide', text: <>אין מרצה מאושר לשישי <span className="num">{fmtDate(e.starts_at)}</span> ({relativeDays(e.starts_at)})</>, to: `/app/events/${e.id}/edit`, action: 'לשיבוץ' }),
    (n) => ({ icon: 'mic', tone: 'tide', text: <><span className="num font-bold">{n}</span> מפגשי שישי בחמשת השבועות הקרובים עדיין בלי מרצה מאושר</>, to: '/app/events', action: 'למפגשים' }));
  capped(a.drafts_soon,
    (e) => ({ icon: 'calendar', tone: 'tide', text: <>{e.title} ב-<span className="num">{fmtDate(e.starts_at)}</span> עדיין טיוטה</>, to: `/app/events/${e.id}`, action: 'לפתיחה' }),
    (n) => ({ icon: 'calendar', tone: 'tide', text: <><span className="num font-bold">{n}</span> מפגשים בשבוע הקרוב עדיין טיוטה, וההרשמה אליהם סגורה</>, to: '/app/events', action: 'למפגשים' }));
  const mism = a.name_mismatches ?? [];
  capped(mism,
    (m) => ({ icon: 'alert', tone: 'warn', text: <>נרשם/ה בשם "{m.typed_name}" עם הטלפון של {m.card_name}. ייתכן שהוקלד מספר שגוי.</>, to: `/app/events/${m.event_id}?tab=registrations`, action: 'לבירור' }),
    (n) => ({ icon: 'alert', tone: 'warn', text: <><span className="num font-bold">{n}</span> הרשמות בשם שונה מהשם בכרטיס (ייתכן מספר טלפון שגוי)</>, to: '/app/events', action: 'למפגשים' }));
  if (a.proposals_pending) items.push({ icon: 'mic', tone: 'tide', text: <><span className="num font-bold">{a.proposals_pending}</span> הצעות להרצאה או הדרכה מחכות לאישור</>, to: '/app/speakers?tab=proposals', action: 'לצפייה' });
  if (a.followups_mine) items.push({ icon: 'task', tone: 'tide', text: <><span className="num font-bold">{a.followups_mine}</span> משימות פתוחות משויכות אליך</>, to: '/app/followups', action: 'למשימות שלי' });

  if (!items.length) {
    return <EmptyState icon="checkCircle" title="הכול מטופל">אין מפגשים פתוחים, משימות באיחור או קבועים שנעלמו.</EmptyState>;
  }
  const toneCls = { bad: 'bg-bad-wash text-bad', warn: 'bg-warn-wash text-warn', tide: 'bg-tide-wash text-tide' };
  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toneCls[it.tone]}`}><Icon name={it.icon} size={17} /></span>
          <span className="flex-1 text-[0.95rem] leading-snug">{it.text}</span>
          <Link to={it.to} className="shrink-0 text-sm font-semibold text-tide hover:underline">{it.action}</Link>
        </li>
      ))}
      {a.followups_open > 0 && <li className="pt-3 text-sm text-muted">סה״כ <Badge>{a.followups_open}</Badge> משימות מעקב פתוחות</li>}
    </ul>
  );
}
