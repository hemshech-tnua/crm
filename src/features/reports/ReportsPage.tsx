import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtDate, fmtMonth } from '@/lib/dates';
import { num, pct, ratio } from '@/lib/metrics';
import { toCsv, downloadFile, type Column } from '@/lib/csv';
import { EVENT_TYPE_LABEL } from '@/lib/labels';
import type { EventType } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, PageHeader, Panel, Skeleton, Tabs } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { Columns, SplitBars } from '@/ui/charts';
import { FilterBar, rpcArgs, useFilters, type Filters } from './period';
import { Drilldown, type DrillKind } from './Drilldown';

type Tab = 'events' | 'monthly' | 'sources' | 'presenters' | 'retention' | 'definitions';

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'events';
  const [filters, set] = useFilters({ period: 'year' });
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };

  return (
    <>
      <PageHeader title="דוחות" subtitle="כל מספר כאן מחושב מהנוכחות שסומנה בפועל, לפי ההגדרות שבלשונית 'איך מחשבים'." />
      <Tabs<Tab>
        label="סוגי דוחות"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'events', label: 'לפי מפגש' },
          { value: 'monthly', label: 'לפי חודש' },
          { value: 'sources', label: 'מקורות והפניות' },
          { value: 'presenters', label: 'מרצים ומדריכים' },
          { value: 'retention', label: 'התמדה' },
          { value: 'definitions', label: 'איך מחשבים' },
        ]}
      />
      {tab !== 'definitions' && <div className="mb-5"><FilterBar filters={filters} set={set} custom showType={tab !== 'sources'} /></div>}
      {tab === 'events' && <EventsReport filters={filters} />}
      {tab === 'monthly' && <MonthlyReport filters={filters} />}
      {tab === 'sources' && <SourcesReport filters={filters} />}
      {tab === 'presenters' && <PresentersReport filters={filters} />}
      {tab === 'retention' && <RetentionReport filters={filters} />}
      {tab === 'definitions' && <Definitions />}
    </>
  );
}

function useExport() {
  const toast = useToast();
  return async <T,>(kind: string, name: string, rows: T[], cols: Column<T>[]) => {
    downloadFile(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols));
    const { error } = await supabase.rpc('log_export', { p_kind: kind, p_rows: rows.length });
    if (error) toast.error(errorMessage(error));
  };
}

function State({ q, empty, children }: { q: { isLoading: boolean; error: unknown; refetch: () => void }; empty: boolean; children: ReactNode }) {
  if (q.isLoading) return <Skeleton lines={6} />;
  if (q.error) return <ErrorBox error={errorMessage(q.error)} onRetry={q.refetch} />;
  if (empty) return <EmptyState icon="chart" title="אין נתונים לתקופה הזו">נסו תקופה ארוכה יותר, או סוג פעילות אחר.</EmptyState>;
  return <>{children}</>;
}

const th = 'px-3 py-2.5 text-right text-sm font-semibold text-muted whitespace-nowrap';
const td = 'px-3 py-2.5 whitespace-nowrap';

// ───────────── per event ─────────────

type EventReportRow = {
  id: string; title: string; type: EventType; status: string; starts_at: string; capacity: number | null; site_name: string;
  lecture_topic: string | null; activity_name: string | null; speaker_name: string | null; instructor_name: string | null;
  registered_count: number; waitlisted_count: number; cancelled_count: number; attended_count: number; walk_in_count: number;
  no_show_count: number; attended_registered_count: number; new_count: number; returning_count: number; self_checkin_count: number;
  feedback_count: number; avg_overall: number | null; avg_activity: number | null; avg_lecture: number | null;
};

function EventsReport({ filters }: { filters: Filters }) {
  const q = useQuery({
    queryKey: ['report_events', filters],
    queryFn: async () => must(await supabase.rpc('report_events', { ...rpcArgs(filters), p_past_only: true })) as EventReportRow[],
  });
  const exp = useExport();
  const rows = [...(q.data ?? [])].reverse();
  const cols: Column<EventReportRow>[] = [
    { header: 'תאריך', value: (r) => fmtDate(r.starts_at) },
    { header: 'סוג', value: (r) => EVENT_TYPE_LABEL[r.type] },
    { header: 'כותרת', value: (r) => r.title },
    { header: 'מרצה', value: (r) => r.speaker_name },
    { header: 'נושא', value: (r) => r.lecture_topic },
    { header: 'נרשמו', value: (r) => r.registered_count },
    { header: 'הגיעו', value: (r) => r.attended_count },
    { header: 'מתוכם בלי הרשמה', value: (r) => r.walk_in_count },
    { header: 'חדשים', value: (r) => r.new_count },
    { header: 'חוזרים', value: (r) => r.returning_count },
    { header: 'שיעור הגעה', value: (r) => pct(ratio(r.attended_registered_count, r.registered_count)) },
    { header: 'ביטולים', value: (r) => r.cancelled_count },
    { header: 'דירוג כללי', value: (r) => r.avg_overall },
    { header: 'דירוג פעילות', value: (r) => r.avg_activity },
    { header: 'דירוג הרצאה', value: (r) => r.avg_lecture },
    { header: 'משובים', value: (r) => r.feedback_count },
  ];
  return (
    <State q={q} empty={!rows.length}>
      <Panel padded={false} title={`${rows.length} מפגשים שהתקיימו`} actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('events', 'mifgashim', rows, cols)}>ייצוא לאקסל</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.93rem]">
            <thead className="border-b border-line-soft bg-mist/50">
              <tr>
                <th className={th}>מפגש</th><th className={th}>מרצה ונושא</th><th className={th}>נרשמו</th><th className={th}>הגיעו</th>
                <th className={th}>חדשים</th><th className={th}>חוזרים</th><th className={th}>שיעור הגעה</th><th className={th}>דירוג</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((r) => {
                const show = ratio(r.attended_registered_count, r.registered_count);
                return (
                  <tr key={r.id} className="hover:bg-mist/40">
                    <td className={td}>
                      <Link to={`/app/events/${r.id}?tab=summary`} className="font-semibold text-ink hover:text-tide hover:underline">{r.title}</Link>
                      <div className="text-sm text-muted"><span className="num">{fmtDate(r.starts_at)}</span> · {EVENT_TYPE_LABEL[r.type]}{r.status !== 'completed' && <> · <Badge tone="warn">לא נסגר</Badge></>}</div>
                    </td>
                    <td className={`${td} max-w-60 truncate`} title={[r.speaker_name, r.lecture_topic].filter(Boolean).join(': ')}>
                      {r.speaker_name ?? <span className="text-faint">—</span>}
                      {r.lecture_topic && <div className="truncate text-sm text-muted">{r.lecture_topic}</div>}
                    </td>
                    <td className={`${td} num`}>{r.registered_count}</td>
                    <td className={`${td} num font-display text-lg`}>{r.attended_count}</td>
                    <td className={`${td} num`}>{r.new_count}</td>
                    <td className={`${td} num`}>{r.returning_count}</td>
                    <td className={`${td} num`}>{pct(show)}</td>
                    <td className={`${td} num`}>{num(r.avg_overall, 1)}{r.feedback_count ? <span className="text-xs text-muted"> ({r.feedback_count})</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </State>
  );
}

// ───────────── per month ─────────────

type MonthRow = { month: string; events: number; attendances: number; unique_attendees: number; new_attendees: number; preregistered: number; preregistered_attended: number; avg_rating: number | null; feedback_count: number };

function MonthlyReport({ filters }: { filters: Filters }) {
  const q = useQuery({
    queryKey: ['report_monthly', filters],
    queryFn: async () => must(await supabase.rpc('report_monthly', rpcArgs(filters))) as MonthRow[],
  });
  const exp = useExport();
  const rows = q.data ?? [];
  const cols: Column<MonthRow>[] = [
    { header: 'חודש', value: (r) => fmtMonth(r.month) },
    { header: 'מפגשים', value: (r) => r.events },
    { header: 'הגעות', value: (r) => r.attendances },
    { header: 'לוחמים שונים', value: (r) => r.unique_attendees },
    { header: 'חדשים', value: (r) => r.new_attendees },
    { header: 'ממוצע למפגש', value: (r) => num(ratio(r.attendances, r.events), 1) },
    { header: 'שיעור הגעה', value: (r) => pct(ratio(r.preregistered_attended, r.preregistered)) },
    { header: 'דירוג', value: (r) => r.avg_rating },
  ];
  return (
    <State q={q} empty={!rows.length}>
      <Panel title="הגעות לפי חודש" className="mb-5">
        <Columns data={rows.map((r) => ({ key: r.month, label: fmtMonth(r.month), total: r.attendances, highlight: r.new_attendees, title: `${r.attendances} הגעות, ${r.new_attendees} חדשים` }))} />
        <div className="mt-2 flex gap-5 text-sm text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-light" />חדשים באותו חודש</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-ink/85" />שאר ההגעות</span>
        </div>
      </Panel>
      <Panel padded={false} title="פירוט" actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('monthly', 'chodashi', rows, cols)}>ייצוא לאקסל</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.93rem]">
            <thead className="border-b border-line-soft bg-mist/50"><tr>{cols.map((c) => <th key={c.header} className={th}>{c.header}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {[...rows].reverse().map((r) => (
                <tr key={r.month}>{cols.map((c, i) => <td key={c.header} className={`${td} ${i ? 'num' : 'font-semibold'}`}>{String(c.value(r) ?? '—')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </State>
  );
}

// ───────────── sources, links, referrers ─────────────

type SourceRow = { source_id: string | null; label: string; is_friend: boolean; participants: number; returned: number; avg_attended: number | null; with_referrer: number; registered_only: number };
type LinkRow = { id: string; code: string; label: string; source_label: string | null; campaign: string | null; is_active: boolean; registrations: number; attended: number; new_people: number };
type Referrers = { referrers: { id: string; full_name: string; friends: number; friends_attended: number; friends_returned: number }[]; unlinked_names: number };

function SourcesReport({ filters }: { filters: Filters }) {
  const s = useQuery({ queryKey: ['report_sources', filters.from, filters.to], queryFn: async () => must(await supabase.rpc('report_sources', { p_from: filters.from, p_to: filters.to })) as SourceRow[] });
  const l = useQuery({ queryKey: ['report_links', filters.from, filters.to], queryFn: async () => must(await supabase.rpc('report_links', { p_from: filters.from, p_to: filters.to })) as LinkRow[] });
  const r = useQuery({ queryKey: ['report_referrers', filters.from, filters.to], queryFn: async () => must(await supabase.rpc('report_referrers', { p_from: filters.from, p_to: filters.to })) as Referrers });
  const exp = useExport();
  const sources = s.data ?? [];
  const srcCols: Column<SourceRow>[] = [
    { header: 'מקור', value: (x) => x.label },
    { header: 'הגיעו לראשונה בתקופה', value: (x) => x.participants },
    { header: 'חזרו (2+ מפגשים)', value: (x) => x.returned },
    { header: 'שיעור חזרה', value: (x) => pct(ratio(x.returned, x.participants)) },
    { header: 'ממוצע מפגשים ללוחם', value: (x) => x.avg_attended },
    { header: 'נרשמו ועוד לא הגיעו', value: (x) => x.registered_only },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Panel title="מקור ההיכרות: מי הגיע לראשונה בתקופה, וכמה חזרו" actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('sources', 'mekorot', sources, srcCols)}>ייצוא לאקסל</Button>}>
        <State q={s} empty={!sources.length}>
          <div className="grid gap-6 lg:grid-cols-2">
            <SplitBars totalLabel="הגיעו פעם אחת" partLabel="חזרו" rows={sources.filter((x) => x.participants > 0).map((x) => ({ key: x.source_id ?? 'none', label: x.label, total: x.participants, part: x.returned, note: x.registered_only ? `${x.registered_only} נרשמו ועוד לא הגיעו` : undefined }))} />
            <table className="w-full self-start text-[0.93rem]">
              <thead className="border-b border-line-soft"><tr><th className={th}>מקור</th><th className={th}>חדשים</th><th className={th}>חזרו</th><th className={th}>ממוצע מפגשים</th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {sources.map((x) => (
                  <tr key={x.source_id ?? 'none'}>
                    <td className={td}>{x.label}</td>
                    <td className={`${td} num`}>{x.participants}</td>
                    <td className={`${td} num`}>{x.returned} <span className="text-muted">({pct(ratio(x.returned, x.participants))})</span></td>
                    <td className={`${td} num`}>{num(x.avg_attended, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </State>
      </Panel>

      <Panel title="קישורי הרשמה לפי ערוץ וקמפיין" actions={<Link to="/app/settings?tab=links" className="text-sm font-semibold text-tide hover:underline">ניהול קישורים</Link>}>
        <State q={l} empty={!(l.data ?? []).length}>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.93rem]">
              <thead className="border-b border-line-soft"><tr><th className={th}>קישור</th><th className={th}>ערוץ</th><th className={th}>הרשמות</th><th className={th}>הגיעו</th><th className={th}>אנשים חדשים</th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {(l.data ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className={td}><span className="font-semibold">{x.label}</span> <span className="num text-sm text-muted">?ref={x.code}</span>{!x.is_active && <> <Badge>לא פעיל</Badge></>}</td>
                    <td className={td}>{x.source_label ?? '—'}{x.campaign && <div className="text-sm text-muted">{x.campaign}</div>}</td>
                    <td className={`${td} num`}>{x.registrations}</td>
                    <td className={`${td} num`}>{x.attended}</td>
                    <td className={`${td} num`}>{x.new_people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </State>
      </Panel>

      <Panel title="מי הביא את מי">
        <State q={r} empty={!r.data?.referrers.length && !r.data?.unlinked_names}>
          {r.data && (
            <>
              {r.data.unlinked_names > 0 && (
                <p className="mb-3 text-sm text-warn">{r.data.unlinked_names} לוחמים כתבו שם של חבר שעוד לא קושר לכרטיס. אפשר לקשר מתוך כרטיס הלוחם.</p>
              )}
              <ul className="divide-y divide-line-soft">
                {r.data.referrers.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5">
                    <Link to={`/app/participants/${x.id}`} className="min-w-40 flex-1 font-semibold hover:text-tide hover:underline">{x.full_name}</Link>
                    <span className="text-sm">הביא/ה <span className="num font-display text-lg">{x.friends}</span></span>
                    <span className="text-sm text-muted">הגיעו: <span className="num">{x.friends_attended}</span></span>
                    <span className="text-sm text-muted">חזרו: <span className="num">{x.friends_returned}</span></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </State>
      </Panel>
    </div>
  );
}

// ───────────── presenters ─────────────

type PresenterRow = { id: string; full_name: string; kind: 'speaker' | 'instructor'; topic: string | null; events: number; avg_attendance: number | null; new_attendees: number; avg_rating: number | null; topics: string | null };

function PresentersReport({ filters }: { filters: Filters }) {
  const q = useQuery({
    queryKey: ['report_presenters', filters.from, filters.to, filters.site],
    queryFn: async () => must(await supabase.rpc('report_presenters', { p_from: filters.from, p_to: filters.to, p_site: filters.site })) as PresenterRow[],
  });
  const exp = useExport();
  const rows = q.data ?? [];
  const cols: Column<PresenterRow>[] = [
    { header: 'שם', value: (x) => x.full_name },
    { header: 'תפקיד', value: (x) => (x.kind === 'speaker' ? 'מרצה' : 'מדריך/ה') },
    { header: 'נושאים', value: (x) => x.topics ?? x.topic },
    { header: 'מפגשים', value: (x) => x.events },
    { header: 'ממוצע משתתפים', value: (x) => x.avg_attendance },
    { header: 'חדשים שהגיעו', value: (x) => x.new_attendees },
    { header: 'דירוג ממוצע', value: (x) => x.avg_rating },
  ];
  return (
    <State q={q} empty={!rows.length}>
      <Panel padded={false} title="מי ואיזה נושא מביאים הכי הרבה לוחמים" actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('presenters', 'martzim', rows, cols)}>ייצוא לאקסל</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.93rem]">
            <thead className="border-b border-line-soft bg-mist/50"><tr>
              <th className={th}>שם</th><th className={th}>נושאים</th><th className={th}>מפגשים</th><th className={th}>ממוצע משתתפים</th><th className={th}>חדשים</th><th className={th}>דירוג</th>
            </tr></thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((x) => (
                <tr key={x.id}>
                  <td className={td}><span className="font-semibold">{x.full_name}</span> <Badge tone={x.kind === 'speaker' ? 'tide' : 'neutral'}>{x.kind === 'speaker' ? 'מרצה' : 'מדריך/ה'}</Badge></td>
                  <td className={`${td} max-w-72 truncate`} title={x.topics ?? ''}>{x.topics ?? x.topic ?? '—'}</td>
                  <td className={`${td} num`}>{x.events}</td>
                  <td className={`${td} num font-display text-lg`}>{num(x.avg_attendance, 1)}</td>
                  <td className={`${td} num`}>{x.new_attendees}</td>
                  <td className={`${td} num`}>{num(x.avg_rating, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </State>
  );
}

// ───────────── retention ─────────────

function RetentionReport({ filters }: { filters: Filters }) {
  const [drill, setDrill] = useState<DrillKind | null>(null);
  const q = useQuery({
    queryKey: ['report_distribution', filters.type, filters.site],
    queryFn: async () => must(await supabase.rpc('report_distribution', { p_type: filters.type, p_site: filters.site })) as { bucket: string; participants: number }[],
  });
  const total = (q.data ?? []).reduce((s, b) => s + b.participants, 0);
  return (
    <div className="flex flex-col gap-5">
      <Panel title="לכמה מפגשים כל לוחם הגיע (מאז ומעולם)">
        <State q={q} empty={total === 0}>
          <Columns data={(q.data ?? []).map((b) => ({ key: b.bucket, label: `${b.bucket} ${b.bucket === '1' ? 'מפגש' : 'מפגשים'}`, total: b.participants, highlight: 0 }))} />
          <p className="mt-3 text-sm text-muted">
            {total} לוחמים הגיעו לפחות פעם אחת. {q.data && q.data[0] ? `${pct(ratio(total - q.data[0].participants, total))} מהם חזרו לפחות פעם נוספת.` : ''}
          </p>
        </State>
      </Panel>
      <Panel title="רשימות לפי התקופה שנבחרה">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="people" onClick={() => setDrill('attendees')}>כל מי שהגיע</Button>
          <Button variant="secondary" icon="userPlus" onClick={() => setDrill('new')}>חדשים</Button>
          <Button variant="secondary" icon="undo" onClick={() => setDrill('returning')}>חוזרים</Button>
          <Button variant="secondary" icon="link" onClick={() => setDrill('friend_new')}>חדשים דרך חבר</Button>
          <Link to="/app/participants?status=lapsed" className="inline-flex h-11 items-center px-3 font-semibold text-tide hover:underline">קבועים שהפסיקו להגיע</Link>
        </div>
      </Panel>
      <Drilldown kind={drill} filters={filters} onClose={() => setDrill(null)} />
    </div>
  );
}

function Definitions() {
  const defs: [string, string][] = [
    ['נרשם', 'הרשמה בסטטוס "רשום" שנעשתה לפני המפגש. ממתינים, מבטלים ומי שהגיע בלי הרשמה לא נספרים כנרשמים.'],
    ['הגיע', 'מי שסומן "הגיע" בצ׳ק־אין העצמי או ברשימת הנוכחות, כולל מי שהגיע בלי הרשמה. הרשמה לבדה היא לא הגעה.'],
    ['שיעור הגעה (יעד 80%)', 'מבין מי שנרשם מראש ולא ביטל: כמה הגיעו בפועל.'],
    ['חדש', 'לוחם שזו הייתה הפעם הראשונה שלו בפעילות כלשהי של העמותה.'],
    ['חוזר', 'לוחם שהגיע בעבר לפעילות אחרת.'],
    ['ממוצע משתתפים (יעד 20)', 'סך ההגעות חלקי מספר המפגשים שהתקיימו בתקופה.'],
    ['הגיעו ליותר ממפגש אחד (יעד 20%)', 'מבין הלוחמים שהגיעו בתקופה: כמה הגיעו בסך הכול לשני מפגשים או יותר מאותו סוג (עד סוף התקופה).'],
    ['הגיעו דרך חבר (יעד 25%)', 'מבין החדשים בתקופה: כמה סימנו שחבר הביא אותם, או נרשמו דרך קישור הזמנה אישי.'],
    ['דירוג ממוצע (יעד 4)', 'ממוצע "הדירוג הכללי" במשובים על מפגשי התקופה.'],
    ['שיעור חזרה של מקור', 'מבין מי שהגיע לראשונה דרך המקור בתקופה: כמה הגיעו לפחות פעם נוספת, בכל זמן.'],
    ['קבוע/ה', 'הגיע/ה ל-2 מפגשי שישי לפחות ב-30 הימים האחרונים (ניתן לשינוי בהגדרות).'],
    ['הפסיק/ה להגיע', 'מי שהיה קבוע בעבר, ומאז ביקורו האחרון התקיימו 3 מפגשי שישי במתחם שלו בלי שהגיע (ניתן לשינוי).'],
    ['שלושה סוגי מקור', 'מקור ההיכרות נשמר בכרטיס הלוחם בהרשמה הראשונה ולא משתנה. "מי הפנה" וקישור הערוץ/הקמפיין נשמרים בכל הרשמה בנפרד.'],
    ['כשאין נתונים', 'מוצג "—" ולא 0%. מפגש שלא נסגר נספר לפי הנוכחות שסומנה עד עכשיו.'],
  ];
  return (
    <Panel>
      <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        {defs.map(([k, v]) => (
          <div key={k}>
            <dt className="font-bold">{k}</dt>
            <dd className="mt-0.5 leading-relaxed text-ink-soft">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
