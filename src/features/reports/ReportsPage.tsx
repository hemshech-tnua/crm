import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtDate, fmtListDate, fmtMonth, todayIl } from '@/lib/dates';
import { num, pct, ratio } from '@/lib/metrics';
import { toCsv, downloadFile, csvFileName, type Column } from '@/lib/csv';
import { fmtMoney } from '@/lib/money';
import { EVENT_TYPE_LABEL, MONEY_LABEL, engagementHint } from '@/lib/labels';
import { useSettings } from '@/lib/data';
import type { EventType } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, Notice, PageHeader, Panel, Skeleton, Tabs, cx } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { Columns, SplitBars } from '@/ui/charts';
import { FilterBar, FilterSheetChip, periodLabel, rpcArgs, useFilters, type Filters } from './period';
import { Drilldown, UnpaidDrilldown, type DrillKind } from './Drilldown';
import { UnmatchedPayments } from '@/features/events/UnmatchedPayments';

type Tab = 'events' | 'monthly' | 'sources' | 'presenters' | 'retention' | 'finance' | 'definitions';

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'events';
  // money is read by the month ("how much came in this month"); the other reports by the year
  const [filters, set] = useFilters({ period: tab === 'finance' ? 'month' : 'year' });
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };

  return (
    <>
      <PageHeader title="דוחות" subtitle='כל מספר כאן מחושב מהנוכחות שסומנה בפועל, לפי ההגדרות שבלשונית "איך מחשבים".' />
      <Tabs<Tab>
        label="סוגי דוחות"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'events', label: 'לפי מפגש' },
          { value: 'monthly', label: 'לפי חודש' },
          { value: 'sources', label: 'מקורות והזמנות' },
          { value: 'presenters', label: 'מרצים ומדריכים' },
          { value: 'retention', label: 'התמדה' },
          { value: 'finance', label: 'כספים' },
          { value: 'definitions', label: 'איך מחשבים' },
        ]}
      />
      {/* a phone gets one chip naming the active filters, which opens them in a sheet; wider screens show the bar */}
      {tab !== 'definitions' && (
        <div className="mb-5">
          <div className="max-sm:hidden"><FilterBar filters={filters} set={set} custom showType={tab !== 'sources'} /></div>
          <FilterSheetChip filters={filters} set={set} custom showType={tab !== 'sources'} title="סינון הדוח" />
        </div>
      )}
      {tab === 'events' && <EventsReport filters={filters} />}
      {tab === 'monthly' && <MonthlyReport filters={filters} />}
      {tab === 'sources' && <SourcesReport filters={filters} />}
      {tab === 'presenters' && <PresentersReport filters={filters} />}
      {tab === 'retention' && <RetentionReport filters={filters} />}
      {tab === 'finance' && <FinanceReport filters={filters} />}
      {tab === 'definitions' && <Definitions />}
    </>
  );
}

/**
 * "ייצוא לאקסל": a Hebrew file name with the period ("כספים 01.11.2026-30.11.2026.csv"), an optional totals row,
 * and a short toast. The export is logged like every other one.
 */
function useExport() {
  const toast = useToast();
  return async <T,>(kind: string, title: string, rows: T[], cols: Column<T>[], opts: { filters?: Filters; footer?: (string | number | null)[] } = {}) => {
    const f = opts.filters;
    const name = csvFileName(title, f ? { from: f.from, to: f.to ?? todayIl() } : undefined);
    downloadFile(name, toCsv(rows, cols, opts.footer));
    const { error } = await supabase.rpc('log_export', { p_kind: kind, p_rows: rows.length });
    if (error) toast.error(errorMessage(error));
    else toast.success('הקובץ ירד');
  };
}

const sum = <T,>(rows: T[], f: (r: T) => number | null | undefined) => rows.reduce((s, r) => s + Number(f(r) ?? 0), 0);

/** Loading (a skeleton in the shape of what comes), error with a retry, empty, or the report. */
function State({ q, empty, skeleton, children }: { q: { isLoading: boolean; error: unknown; data?: unknown; refetch: () => void }; empty: boolean; skeleton?: ReactNode; children: ReactNode }) {
  if (q.isLoading) return <>{skeleton ?? <Skeleton lines={6} />}</>;
  // with data on screen a failed refresh keeps it (the offline bar explains); the box only when there is nothing to show
  if (q.error && q.data === undefined) return <ErrorBox error={errorMessage(q.error)} onRetry={q.refetch} />;
  if (empty) return <EmptyState icon="chart" title="אין נתונים לתקופה הזו">אפשר לבחור תקופה ארוכה יותר או סוג מפגש אחר.</EmptyState>;
  return <>{children}</>;
}

// the kit's Th/Td look (ui/kit.tsx), as class strings: these tables are built from column lists
const th = 'h-10 bg-mist/70 px-3 text-right text-micro font-medium text-muted whitespace-nowrap first:ps-4 last:pe-4';
const td = 'h-12 px-3 py-2 whitespace-nowrap first:ps-4 last:pe-4';

// Per-meeting tables on a phone: every meeting is two lines — the title, then one meta line with its numbers
// ("23.11.26 · 12 נרשמו · 9 הגיעו · 75% · דירוג 4.6"); the column cells hide. The first PHONE_ROWS meetings show, "עוד"
// adds more. Same table element and order, so desktop, export and tests are unchanged.
const PHONE_ROWS = 20;
const stack = {
  table: 'max-sm:block',
  head: 'max-sm:hidden',
  body: 'max-sm:block',
  row: 'max-sm:block max-sm:px-4 max-sm:py-2.5',
  wide: 'max-sm:block max-sm:h-auto max-sm:p-0 max-sm:first:ps-0 max-sm:last:pe-0 max-sm:whitespace-normal',
  cell: 'max-sm:hidden',
};
/** The phone's meta line under a meeting's title (hidden from `sm` up, where the columns show). */
const PhoneMeta = ({ children }: { children: ReactNode }) => <div className="mt-0.5 text-small font-normal text-muted sm:hidden">{children}</div>;
/** How many meetings a phone shows, and the "עוד" button that shows the next ones (phones only). */
function usePhoneRows(total: number) {
  const [shown, setShown] = useState(PHONE_ROWS);
  const rest = total - shown;
  return {
    hide: (i: number) => (i >= shown ? 'max-sm:hidden' : undefined),
    /** the last row of the table body (before any totals row) */
    more: rest > 0 && (
      <tr className="sm:hidden max-sm:block">
        <td colSpan={99} className="max-sm:block px-4 py-3">
          <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PHONE_ROWS)}>
            עוד <span className="num">{Math.min(rest, PHONE_ROWS)}</span> מפגשים
            <span className="font-normal text-muted">(<span className="num">{rest}</span> שלא מוצגים)</span>
          </Button>
        </td>
      </tr>
    ),
  };
}

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
  const unclosed = rows.filter((r) => r.status !== 'completed').length;
  const phone = usePhoneRows(rows.length);
  const footer = ['סה״כ', '', `${rows.length} מפגשים`, '', '', sum(rows, (r) => r.registered_count), sum(rows, (r) => r.attended_count), sum(rows, (r) => r.walk_in_count),
    sum(rows, (r) => r.new_count), sum(rows, (r) => r.returning_count), '', sum(rows, (r) => r.cancelled_count), '', '', '', sum(rows, (r) => r.feedback_count)];
  return (
    <State q={q} empty={!rows.length} skeleton={<Skeleton shape="rows" count={8} height={64} />}>
      {unclosed > 0 && (
        <div className="mb-4">
          <Notice tone="light" icon="alert">
            <span className="num font-bold">{unclosed}</span> {unclosed === 1 ? 'מפגש מהרשימה עוד לא נסגר' : 'מפגשים מהרשימה עוד לא נסגרו'}, ולכן {unclosed === 1 ? 'הוא לא נספר' : 'הם לא נספרים'} ביעדים. סוגרים בלשונית "סיכום" של המפגש.{' '}
            <Link to="/app/events?show=past&status=unclosed" className="font-semibold text-tide underline underline-offset-2">למפגשים הקודמים</Link>
          </Notice>
        </div>
      )}
      <Panel padded={false} title={`${rows.length} מפגשים שהתקיימו`} actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('events', 'מפגשים', rows, cols, { filters, footer })}>ייצוא לאקסל</Button>}>
        <div className="overflow-x-auto">
          <table className={cx('w-full text-body', stack.table)}>
            <thead className={cx('border-b border-edge', stack.head)}>
              <tr>
                <th className={th}>מפגש</th><th className={th}>מרצה ונושא</th><th className={th}>נרשמו</th><th className={th}>הגיעו</th>
                <th className={th}>חדשים</th><th className={th}>חוזרים</th><th className={th}>שיעור הגעה</th><th className={th}>דירוג</th>
              </tr>
            </thead>
            <tbody className={cx('divide-y divide-edge', stack.body)}>
              {rows.map((r, i) => {
                const show = ratio(r.attended_registered_count, r.registered_count);
                return (
                  <tr key={r.id} className={cx('hover:bg-mist/60', stack.row, phone.hide(i))}>
                    <td className={cx(td, stack.wide)}>
                      <Link to={`/app/events/${r.id}?tab=summary`} className="font-semibold text-ink hover:text-tide hover:underline">{r.title}</Link>
                      {r.status !== 'completed' && <span className="text-small text-muted sm:hidden"> · לא נסגר</span>}
                      <div className="text-small text-muted max-sm:hidden"><span className="num">{fmtDate(r.starts_at)}</span> · {EVENT_TYPE_LABEL[r.type]}{r.status !== 'completed' && <> · לא נסגר</>}</div>
                      <PhoneMeta>
                        <span className="num">{fmtListDate(r.starts_at, { weekday: false, time: false })}</span>
                        {' · '}{r.registered_count === 1 ? 'נרשם אחד' : <><span className="num">{r.registered_count}</span> נרשמו</>}
                        {' · '}{r.attended_count === 1 ? <span className="font-semibold text-ink">הגיע אחד</span> : <><span className="num font-semibold text-ink">{r.attended_count}</span> הגיעו</>}
                        {r.registered_count > 0 && <> · <span className="num">{pct(show)}</span> הגעה</>}
                        {r.avg_overall != null && <> · דירוג <span className="num">{num(r.avg_overall, 1)}</span></>}
                      </PhoneMeta>
                    </td>
                    <td className={cx(td, 'max-w-60 truncate', stack.cell)} title={[r.speaker_name, r.lecture_topic].filter(Boolean).join(': ')}>
                      {r.speaker_name ?? <span className="text-faint">—</span>}
                      {r.lecture_topic && <div className="truncate text-small text-muted">{r.lecture_topic}</div>}
                    </td>
                    <td data-label="נרשמו" className={cx(td, 'num', stack.cell)}>{r.registered_count}</td>
                    <td data-label="הגיעו" className={cx(td, 'num font-bold', stack.cell)}>{r.attended_count}</td>
                    <td data-label="חדשים" className={cx(td, 'num', stack.cell)}>{r.new_count}</td>
                    <td data-label="חוזרים" className={cx(td, 'num', stack.cell)}>{r.returning_count}</td>
                    <td data-label="שיעור הגעה" className={cx(td, 'num', stack.cell)}>{pct(show)}</td>
                    <td data-label="דירוג" className={cx(td, 'num', stack.cell)}>{num(r.avg_overall, 1)}{r.feedback_count ? <span className="text-micro text-muted"> ({r.feedback_count})</span> : null}</td>
                  </tr>
                );
              })}
              {phone.more}
            </tbody>
          </table>
        </div>
      </Panel>
    </State>
  );
}

// ───────────── money ─────────────

type FinanceRow = {
  event_id: string; starts_at: string; title: string; type: EventType; status: string; price: number | null;
  registered: number; paid_count: number; pending_count: number; collected: number; expected: number;
  expenses: number; expenses_paid: number; net: number; projected_net: number;
};
type FinanceTotals = Omit<FinanceRow, 'event_id' | 'starts_at' | 'title' | 'type' | 'status' | 'price'> & { events: number };

function FinanceReport({ filters }: { filters: Filters }) {
  const q = useQuery({
    // under ['event_payments', …]: a supplier payment or a marked fee refreshes the report too
    queryKey: ['event_payments', 'summary', filters],
    queryFn: async () => must(await supabase.rpc('staff_finance_summary', rpcArgs(filters))) as { rows: FinanceRow[]; totals: FinanceTotals },
  });
  const [unpaid, setUnpaid] = useState(false);
  const exp = useExport();
  const rows = [...(q.data?.rows ?? [])].reverse();
  const t = q.data?.totals;
  const cols: Column<FinanceRow>[] = [
    { header: 'תאריך', value: (r) => fmtDate(r.starts_at) },
    { header: 'סוג', value: (r) => EVENT_TYPE_LABEL[r.type] },
    { header: 'כותרת', value: (r) => r.title },
    { header: 'מחיר', value: (r) => r.price },
    { header: 'רשומים', value: (r) => r.registered },
    { header: 'שילמו', value: (r) => r.paid_count },
    { header: 'לא שילמו', value: (r) => r.pending_count },
    { header: 'נגבה', value: (r) => r.collected },
    { header: 'ממתין לתשלום', value: (r) => r.expected - r.collected },
    { header: 'הוצאות', value: (r) => r.expenses },
    { header: 'הוצאות ששולמו', value: (r) => r.expenses_paid },
    { header: 'נטו', value: (r) => r.net },
    { header: 'צפי נטו', value: (r) => r.projected_net },
  ];
  const footer = t ? ['סה״כ', '', `${rows.length} מפגשים`, '', t.registered, t.paid_count, t.pending_count, t.collected, t.expected - t.collected, t.expenses, t.expenses_paid, t.net, t.projected_net] : undefined;
  const money = (v: number) => <span className={v < 0 ? 'text-bad' : undefined}>{fmtMoney(v)}</span>;
  const label = periodLabel(filters);
  // a range of dates reads left to right ("1.1–20.11.26"); a month name stays in the sentence's direction
  const when = /^\d/.test(label) ? <span dir="ltr" className="num inline-block">{label}</span> : label;
  const pending = t ? t.expected - t.collected : 0;
  const phone = usePhoneRows(rows.length);
  return (
    <div className="flex flex-col gap-5">
      <State q={q} empty={!rows.length} skeleton={<Skeleton shape="tiles" count={4} height={118} cols="grid-cols-2 lg:grid-cols-4" />}>
        {t && (
          // one order everywhere: נגבה · עוד לא שולם · הוצאות · נטו (the forecast as a sub-line)
          <section aria-label={`סיכום כספי: ${label}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={MONEY_LABEL.collected} value={money(t.collected)} sub={<><span className="num">{t.paid_count}</span> תשלומים · {when}</>} />
            <Tile
              label={MONEY_LABEL.pending}
              value={money(pending)}
              sub={t.pending_count ? <><span className="num">{t.pending_count}</span> רשומים לא שילמו</> : 'כל הרשומים שילמו'}
              onClick={t.pending_count ? () => setUnpaid(true) : undefined}
              action="מי לא שילמו"
            />
            <Tile label={MONEY_LABEL.expenses} value={money(t.expenses)} sub={<>שולם <span className="num">{fmtMoney(t.expenses_paid)}</span></>} />
            <Tile label={MONEY_LABEL.net} value={money(t.net)} sub={<>צפי <span className="num" dir="ltr">{fmtMoney(t.projected_net)}</span></>} />
          </section>
        )}
      </State>

      <UnmatchedPayments />

      {!!rows.length && (
        <Panel padded={false} title={`כספים לפי מפגש: ${rows.length} מפגשים`} description={<>{when} · מפגשים עם דמי השתתפות, הוצאות או תשלום</>}
          actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('finance', 'כספים', rows, cols, { filters, footer })}>ייצוא לאקסל</Button>}>
          <div className="overflow-x-auto">
            <table className={cx('w-full text-body', stack.table)} aria-label="כספים לפי מפגש">
              <thead className={cx('border-b border-edge', stack.head)}>
                <tr>
                  <th className={th}>מפגש</th><th className={th}>רשומים</th><th className={th}>שילמו</th>
                  <th className={th}>{MONEY_LABEL.collected}</th><th className={th}>{MONEY_LABEL.pending}</th><th className={th}>{MONEY_LABEL.expenses}</th><th className={th}>{MONEY_LABEL.net}</th>
                </tr>
              </thead>
              <tbody className={cx('divide-y divide-edge', stack.body)}>
                {rows.map((r, i) => (
                  <tr key={r.event_id} className={cx('hover:bg-mist/60', stack.row, phone.hide(i))}>
                    <td className={cx(td, stack.wide)}>
                      <Link to={`/app/events/${r.event_id}`} className="font-semibold text-ink hover:text-tide hover:underline">{r.title}</Link>
                      <PhoneMeta>
                        <span className="num">{fmtDate(r.starts_at)}</span>
                        {' · '}שילמו <span className="num">{r.paid_count}</span> מתוך <span className="num">{r.registered}</span>
                        {' · '}{MONEY_LABEL.collected} <span className="num font-semibold text-ink">{fmtMoney(r.collected)}</span>
                        {/* net only when it differs from what came in (there were expenses) */}
                        {r.net !== r.collected && <> · {MONEY_LABEL.net} <span className="num">{money(r.net)}</span></>}
                        {r.status === 'cancelled' && <> · בוטל</>}
                      </PhoneMeta>
                      <div className="text-small text-muted max-sm:hidden">
                        <span className="num">{fmtDate(r.starts_at)}</span> · {EVENT_TYPE_LABEL[r.type]}
                        {r.price ? <> · <span className="num">{fmtMoney(r.price)}</span></> : ' · בלי תשלום'}
                        {r.status === 'cancelled' && <> · <Badge tone="neutral">בוטל</Badge></>}
                      </div>
                    </td>
                    <td data-label="רשומים" className={cx(td, 'num', stack.cell)}>{r.registered}</td>
                    <td data-label="שילמו" className={cx(td, 'num', stack.cell)}>
                      {r.paid_count}
                      {r.pending_count > 0 && (
                        <Link to={`/app/events/${r.event_id}?tab=registrations&filter=unpaid`} className="text-micro text-ink-soft hover:text-tide hover:underline"> (<span className="num">{r.pending_count}</span> לא שילמו)</Link>
                      )}
                    </td>
                    <td data-label={MONEY_LABEL.collected} className={cx(td, 'num font-bold', stack.cell)}>{fmtMoney(r.collected)}</td>
                    <td data-label={MONEY_LABEL.pending} className={cx(td, 'num', stack.cell)}>{r.expected - r.collected > 0 ? fmtMoney(r.expected - r.collected) : <span className="text-faint">—</span>}</td>
                    <td data-label={MONEY_LABEL.expenses} className={cx(td, 'num', stack.cell)}>{fmtMoney(r.expenses)}</td>
                    <td data-label={MONEY_LABEL.net} className={cx(td, 'num font-bold', stack.cell)}>{money(r.net)}</td>
                  </tr>
                ))}
                {phone.more}
              </tbody>
              {t && (
                <tfoot className={cx('border-t-2 border-ink', stack.body)}>
                  <tr className={cx('font-bold', stack.row)}>
                    <td className={cx(td, stack.wide)}>
                      סה״כ
                      <PhoneMeta>
                        שילמו <span className="num">{t.paid_count}</span> מתוך <span className="num">{t.registered}</span>
                        {' · '}{MONEY_LABEL.collected} <span className="num text-ink">{fmtMoney(t.collected)}</span>
                        {pending > 0 && <> · {MONEY_LABEL.pending} <span className="num">{fmtMoney(pending)}</span></>}
                        {' · '}{MONEY_LABEL.net} <span className="num">{money(t.net)}</span>
                      </PhoneMeta>
                    </td>
                    <td data-label="רשומים" className={cx(td, 'num', stack.cell)}>{t.registered}</td>
                    <td data-label="שילמו" className={cx(td, 'num', stack.cell)}>{t.paid_count}</td>
                    <td data-label={MONEY_LABEL.collected} className={cx(td, 'num', stack.cell)}>{fmtMoney(t.collected)}</td>
                    <td data-label={MONEY_LABEL.pending} className={cx(td, 'num', stack.cell)}>{fmtMoney(pending)}</td>
                    <td data-label={MONEY_LABEL.expenses} className={cx(td, 'num', stack.cell)}>{fmtMoney(t.expenses)}</td>
                    <td data-label={MONEY_LABEL.net} className={cx(td, 'num', stack.cell)}>{money(t.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Panel>
      )}
      <UnpaidDrilldown open={unpaid} filters={filters} eventIds={rows.map((r) => r.event_id)} onClose={() => setUnpaid(false)} />
    </div>
  );
}

/** A finance tile; with `onClick` the whole tile opens the list behind the number. */
function Tile({ label, value, sub, onClick, action }: { label: string; value: ReactNode; sub: ReactNode; onClick?: () => void; action?: string }) {
  const body = (
    <>
      <div className="text-small font-medium text-muted">{label}</div>
      {/* a 320px phone fits "59,500₪" in a half-width tile only one step smaller */}
      <div className="num mt-1 text-right font-display text-title-sm text-ink max-[359px]:text-section sm:text-stat">{value}</div>
      <div className="mt-1 text-small text-muted">{sub}</div>
      {onClick && action && <div className="mt-1.5 inline-flex self-start items-center gap-1 text-small font-semibold text-tide underline-offset-2 group-hover:underline">{action}<Icon name="chevron" size={14} /></div>}
    </>
  );
  const box = 'rounded-[var(--radius-panel)] border border-edge bg-paper px-4 py-3';
  return onClick
    ? <button type="button" onClick={onClick} className={cx(box, 'group flex min-h-11 flex-col items-stretch text-right transition-colors hover:border-ink focus-visible:border-ink')}>{body}</button>
    : <div className={box}>{body}</div>;
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
    <State q={q} empty={!rows.length} skeleton={<Skeleton shape="block" height={300} />}>
      <Panel title="הגעות לפי חודש" className="mb-5">
        <Columns data={rows.map((r) => ({ key: r.month, label: fmtMonth(r.month), total: r.attendances, highlight: r.new_attendees, title: `${r.attendances} הגעות, ${r.new_attendees} חדשים` }))} />
        <div className="mt-2 flex gap-5 text-small text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-tint" />חדשים באותו חודש</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-ink" />שאר ההגעות</span>
        </div>
      </Panel>
      <Panel padded={false} title="פירוט" actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('monthly', 'הגעות לפי חודש', rows, cols, { filters, footer: ['סה״כ', sum(rows, (r) => r.events), sum(rows, (r) => r.attendances)] })}>ייצוא לאקסל</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead className="border-b border-edge"><tr>{cols.map((c) => <th key={c.header} className={th}>{c.header}</th>)}</tr></thead>
            <tbody className="divide-y divide-edge">
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
type Referrers = { referrers: { id: string; full_name: string; friends: number; friends_attended: number; friends_returned: number; friend_list?: { id: string; full_name: string; attended: number }[] }[]; unlinked_names: number };

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
      <Panel title="מקור הגעה: מי הגיע לראשונה בתקופה, וכמה חזרו" actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('sources', 'מקורות', sources, srcCols, { filters })}>ייצוא לאקסל</Button>}>
        <State q={s} empty={!sources.length}>
          {/* min-w-0: the grid's items may shrink to the phone's width (the table scrolls inside, the page does not) */}
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <SplitBars totalLabel="הגיעו פעם אחת" partLabel="חזרו" rows={sources.filter((x) => x.participants > 0).map((x) => ({ key: x.source_id ?? 'none', label: x.label, total: x.participants, part: x.returned, note: x.registered_only ? `${x.registered_only} נרשמו ועוד לא הגיעו` : undefined }))} />
            <div className="self-start overflow-x-auto">
            <table className="w-full text-body">
              <thead className="border-b border-edge"><tr><th className={th}>מקור</th><th className={th}>חדשים</th><th className={th}>חזרו</th><th className={th}>ממוצע מפגשים</th></tr></thead>
              <tbody className="divide-y divide-edge">
                {sources.map((x) => (
                  <tr key={x.source_id ?? 'none'}>
                    <td className={cx(td, 'max-sm:whitespace-normal')}>{x.label}</td>
                    <td className={`${td} num`}>{x.participants}</td>
                    <td className={`${td} num`}>{x.returned} <span className="text-muted">({pct(ratio(x.returned, x.participants))})</span></td>
                    <td className={`${td} num`}>{num(x.avg_attended, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </State>
      </Panel>

      <Panel title="קישורי הרשמה לפי ערוץ וקמפיין" actions={<Link to="/app/settings?tab=links" className="-my-2 inline-flex min-h-11 items-center text-small font-semibold text-tide hover:underline">ניהול קישורים</Link>}>
        <State q={l} empty={!(l.data ?? []).length}>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="border-b border-edge"><tr><th className={th}>קישור</th><th className={th}>ערוץ</th><th className={th}>הרשמות</th><th className={th}>הגיעו</th><th className={th}>חדשים</th></tr></thead>
              <tbody className="divide-y divide-edge">
                {(l.data ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className={td}><span className="font-semibold">{x.label}</span> <span className="num text-small text-muted">?ref={x.code}</span>{!x.is_active && <> <Badge>לא פעיל</Badge></>}</td>
                    <td className={td}>{x.source_label ?? '—'}{x.campaign && <div className="text-small text-muted">{x.campaign}</div>}</td>
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

      <Panel title="מי הזמין את מי">
        <State q={r} empty={!r.data?.referrers.length && !r.data?.unlinked_names}>
          {r.data && (
            <>
              {r.data.unlinked_names > 0 && (
                <p className="mb-3 flex items-start gap-1.5 text-small font-medium text-warn"><Icon name="alert" size={15} className="mt-0.5" />{r.data.unlinked_names} לוחמים כתבו שם של חבר שעוד לא קושר לכרטיס. אפשר לקשר מתוך כרטיס הלוחם.</p>
              )}
              <ul className="divide-y divide-edge">
                {r.data.referrers.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5">
                    <Link to={`/app/participants/${x.id}`} className="min-w-40 flex-1 font-semibold hover:text-tide hover:underline">{x.full_name}</Link>
                    <span className="text-small">הזמנות <span className="num font-bold">{x.friends}</span></span>
                    <span className="text-small text-muted">הגיעו: <span className="num">{x.friends_attended}</span></span>
                    <span className="text-small text-muted">חזרו: <span className="num">{x.friends_returned}</span></span>
                    {x.friend_list?.length ? (
                      <span className="w-full text-small text-ink-soft">
                        {x.friend_list.map((f, i) => (
                          <span key={f.id}>{i > 0 && ' · '}<Link to={`/app/participants/${f.id}`} className="hover:text-tide hover:underline">{f.full_name}</Link>
                            <span className="num text-muted"> ({f.attended})</span></span>
                        ))}
                      </span>
                    ) : null}
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
    { header: 'תפקיד', value: (x) => (x.kind === 'speaker' ? 'מרצה' : 'מדריך') },
    { header: 'נושאים', value: (x) => x.topics ?? x.topic },
    { header: 'מפגשים', value: (x) => x.events },
    { header: 'ממוצע לוחמים', value: (x) => x.avg_attendance },
    { header: 'חדשים שהגיעו', value: (x) => x.new_attendees },
    { header: 'דירוג (הרצאה למרצים, פעילות למדריכים)', value: (x) => x.avg_rating },
  ];
  const table = (kind: 'speaker' | 'instructor') => {
    const list = rows.filter((x) => x.kind === kind);
    if (!list.length) return <p className="p-5 text-muted">אין עדיין מפגשים שנסגרו בתקופה.</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead className="border-b border-edge"><tr>
            <th className={th}>שם</th><th className={th}>{kind === 'speaker' ? 'נושאי ההרצאות' : 'פעילויות'}</th><th className={th}>מפגשים</th>
            <th className={th}>ממוצע לוחמים</th><th className={th}>חדשים</th><th className={th}>{kind === 'speaker' ? 'דירוג ההרצאה' : 'דירוג הפעילות'}</th>
          </tr></thead>
          <tbody className="divide-y divide-edge">
            {list.map((x) => (
              <tr key={x.id}>
                <td className={`${td} font-semibold`}>{x.full_name}</td>
                <td className={`${td} max-w-72 truncate`} title={x.topics ?? ''}>{x.topics ?? x.topic ?? '—'}</td>
                <td className={`${td} num`}>{x.events}</td>
                <td className={`${td} num font-bold`}>{num(x.avg_attendance, 1)}</td>
                <td className={`${td} num`}>{x.new_attendees}</td>
                <td className={`${td} num`}>{num(x.avg_rating, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <State q={q} empty={!rows.length}>
      <div className="flex flex-col gap-5">
        <Panel padded={false} title="מרצים אורחים: מי ואיזה נושא מביאים הכי הרבה לוחמים" actions={<Button size="sm" variant="secondary" icon="download" onClick={() => exp('presenters', 'מרצים ומדריכים', rows, cols, { filters })}>ייצוא לאקסל</Button>}>
          {table('speaker')}
        </Panel>
        <Panel padded={false} title="מדריכים">
          {table('instructor')}
        </Panel>
      </div>
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
          <p className="mt-3 text-small text-muted">
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
  // the goals and the regular/lapsed thresholds are editable in the settings: name the current ones, never a fixed number
  const st = useSettings().data;
  const goal = (v: string | null) => (v ? ` (יעד ${v})` : '');
  const target = (v: number | undefined) => (v == null ? null : pct(v));
  const defs: [string, string][] = [
    ['נרשם', 'הרשמה פעילה שנעשתה לפני המפגש. מי שברשימת ההמתנה, מי שביטל ומי שהגיע בלי הרשמה לא נספרים כנרשמים.'],
    ['הגיע', 'מי שסומנה לו "הגעה" בצ׳ק־אין העצמי או ברשימת הנוכחות, כולל מי שהגיע בלי הרשמה. הרשמה לבדה היא לא הגעה.'],
    [`שיעור הגעה${goal(target(st?.goal_show_rate))}`, 'מבין מי שנרשם מראש ולא ביטל: כמה הגיעו בפועל.'],
    ['חדש', 'לוחם שזו הייתה הפעם הראשונה שלו במפגש כלשהו של העמותה.'],
    ['חוזר', 'לוחם שהגיע בעבר למפגש אחר.'],
    [`ממוצע לוחמים${goal(st ? num(st.goal_avg_attendance, 0) : null)}`, 'סך ההגעות חלקי מספר המפגשים שהתקיימו בתקופה.'],
    [`הגיעו ליותר ממפגש אחד${goal(target(st?.goal_return_rate))}`, 'מבין הלוחמים שהגיעו בתקופה: כמה הגיעו בסך הכול לשני מפגשים או יותר מאותו סוג (עד סוף התקופה).'],
    [`הגיעו דרך חבר${goal(target(st?.goal_friend_share))}`, 'מבין החדשים בתקופה: כמה סימנו שחבר הביא אותם, או נרשמו דרך קישור הזמנה אישי.'],
    [`דירוג ממוצע${goal(st ? num(st.goal_avg_rating, 1) : null)}`, 'ממוצע "הדירוג הכללי" במשובים על מפגשי התקופה.'],
    ['שיעור חזרה של מקור', 'מבין מי שהגיע לראשונה דרך המקור בתקופה: כמה הגיעו לפחות פעם נוספת, בכל זמן.'],
    ['הגעה קבועה', `${engagementHint('regular', st)}. אפשר לשנות בהגדרות.`],
    ['הגעה שנפסקה', st
      ? `מי שהגיע באופן קבוע בעבר, ומאז ההגעה האחרונה שלו התקיימו ${st.lapsed_after_fridays} מפגשי שישי במתחם שלו בלי שהגיע. אפשר לשנות בהגדרות.`
      : 'מי שהגיע באופן קבוע בעבר, ומאז ההגעה האחרונה שלו התקיימו כמה מפגשי שישי במתחם שלו בלי שהגיע (לפי ההגדרות).'],
    ['שלושה סוגי מקור', 'מקור ההגעה נשמר בכרטיס הלוחם בהרשמה הראשונה ולא משתנה. "מי הזמין" וקישור הערוץ או הקמפיין נשמרים בכל הרשמה בנפרד.'],
    ['כשאין נתונים', 'מוצג "—" ולא 0%.'],
    ['כספים: נגבה', 'סכום התשלומים שסומנו "שולם" (בקישור לתשלום, בכניסה או ידנית), גם של מי שביטל אחרי ששילם, עד שסומן החזר.'],
    ['כספים: צפי', 'מה שנגבה ועוד דמי ההשתתפות של רשומים שעוד לא שילמו. מי שברשימת ההמתנה, מי שלא הגיע ולא שילם ופטורים לא נספרים.'],
    ['כספים: נטו', 'נגבה פחות ההוצאות ששולמו לספקים ולמרצים (לשונית ההכנות של המפגש). מפגשים מכל סטטוס חוץ מטיוטה, כשיש בהם מחיר, הוצאה או תשלום.'],
    ['מפגש שלא נסגר', 'היעדים והדוחות סופרים רק מפגשים שנסגרו ("סגירת המפגש"), כי רק אז הנוכחות סופית. מפגש שהסתיים ולא נסגר מופיע ברשימות עם סימון, ובמסך הסקירה יש תזכורת לסגור אותו.'],
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
