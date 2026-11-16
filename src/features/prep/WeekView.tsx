import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDays, ilParts, todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { Badge, Button, ErrorBox, IconButton, Panel, Skeleton, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { useAssignees } from '@/features/followups/shared';
import {
  DayShort, OVERDUE_DAYS, WEEKDAY_NAME, dm, fmtHours, fmtMoney, fmtTotal, hhmm, sumHours, useOverdueTasks, useTasksBetween, weekStart,
  type TaskEvent, type TaskWithEvent,
} from './shared';
import { Dot, TaskLine } from './TaskLine';
import { useUnpaidPast } from './Payments';

const CAP = 3;
function More({ open, total, onToggle }: { open: boolean; total: number; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 w-full items-center border-t border-edge px-4 text-small font-semibold text-tide hover:underline sm:px-5">
      {open ? 'הצגת פחות' : <>הצגת כל ה-<span className="num">{total}</span></>}
    </button>
  );
}

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function MeetingLink({ event }: { event: TaskEvent }) {
  return (
    <Link to={`/app/events/${event.id}?tab=prep`} className="font-semibold text-tide hover:underline">
      {event.title}{' '}<span className="font-normal">(<DayShort day={ilParts(event.starts_at).date} />)</span>
    </Link>
  );
}

/** "השבוע שלי": the week Sunday to Saturday, day by day, with what was left open before it. */
export function WeekView() {
  const [sp, setSp] = useSearchParams();
  const today = todayIl();
  const thisWeek = weekStart(today);
  const from = isDay(sp.get('week')) ? weekStart(sp.get('week')!) : thisWeek;
  const to = addDays(from, 6);
  const go = (w: string) => setSp(w === thisWeek ? {} : { week: w }, { replace: true });
  const isThisWeek = from === thisWeek;

  const week = useTasksBetween(from, to);
  const overdue = useOverdueTasks();
  const unpaid = useUnpaidPast();
  const { name: staffName } = useAssignees();

  const tasks = useMemo(() => week.data ?? [], [week.data]);
  const byDay = useMemo(() => {
    const m = new Map<string, TaskWithEvent[]>();
    for (const t of tasks) m.set(t.due_date!, [...(m.get(t.due_date!) ?? []), t]);
    for (const list of m.values()) list.sort((a, b) => (hhmm(a.due_time) || '99').localeCompare(hhmm(b.due_time) || '99') || a.event.starts_at.localeCompare(b.event.starts_at) || a.sort_order - b.sort_order);
    return m;
  }, [tasks]);
  const open = tasks.filter((t) => !t.done_at);
  const planned = sumHours(tasks);
  const left = sumHours(open);
  const overdueList = isThisWeek ? (overdue.data ?? []) : [];
  const unpaidList = unpaid.data ?? [];
  const [allOverdue, setAllOverdue] = useState(false);
  const [allUnpaid, setAllUnpaid] = useState(false);

  const meta = (t: TaskWithEvent, withDate = false) => <>
    {withDate && t.due_date && <DayShort day={t.due_date} className="font-semibold text-warn" />}
    {!withDate && t.due_time && <span className="num font-semibold text-ink">{hhmm(t.due_time)}</span>}
    {(withDate || t.due_time) && <Dot />}
    <MeetingLink event={t.event} />
    {t.hours ? <><Dot /><span>{fmtHours(t.hours)}</span></> : null}
    {t.assignee_id && <><Dot /><span>{staffName.get(t.assignee_id) ?? 'צוות'}</span></>}
  </>;

  return (
    <div className="flex flex-col gap-5">
      {/* the week navigator and its total */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton icon="chevron" label="השבוע הקודם" onClick={() => go(addDays(from, -7))} className="rotate-180" />
          <h2 className="flex min-w-36 items-baseline justify-center gap-2 text-heading font-bold">
            {isThisWeek ? 'השבוע' : from === addDays(thisWeek, 7) ? 'השבוע הבא' : from === addDays(thisWeek, -7) ? 'השבוע שעבר' : 'שבוע'}
            <span className="num font-medium text-muted">{dm(from)}–{dm(to)}</span>
          </h2>
          <IconButton icon="chevron" label="השבוע הבא" onClick={() => go(addDays(from, 7))} />
          {!isThisWeek && <Button size="sm" variant="secondary" onClick={() => go(thisWeek)} className="ms-1">חזרה להשבוע</Button>}
        </div>
        {week.data && (
          <p className="text-small text-muted" aria-live="polite">
            <span className="num font-bold text-ink">{fmtTotal(planned)}</span> שעות מתוכננות
            {open.length > 0 && open.length < tasks.length && <> · נותרו <span className="num font-bold text-ink">{fmtTotal(left)}</span></>}
            {' · '}<span className="num">{tasks.length - open.length}/{tasks.length}</span> בוצעו
          </p>
        )}
      </div>

      {(overdueList.length > 0 || unpaidList.length > 0) && (
        <div className={cx('grid items-start gap-5', overdueList.length > 0 && unpaidList.length > 0 && 'lg:grid-cols-2')}>
          {overdueList.length > 0 && (
            <Panel title={<span className="flex items-center gap-2"><Icon name="alert" size={18} className="text-warn" />נשאר פתוח מלפני</span>} description={`משימות שעבר התאריך שלהן (עד ${OVERDUE_DAYS} יום אחורה)`} padded={false} className="border-s-[3px] border-s-warn">
              <ul className="divide-y divide-edge px-4 sm:px-5">
                {(allOverdue ? overdueList : overdueList.slice(0, CAP)).map((t) => <TaskLine key={t.id} task={t} meta={meta(t, true)} />)}
              </ul>
              {overdueList.length > CAP && <More open={allOverdue} total={overdueList.length} onToggle={() => setAllOverdue((v) => !v)} />}
            </Panel>
          )}
          {unpaidList.length > 0 && (
            <Panel title={<span className="flex items-center gap-2"><Icon name="alert" size={18} className="text-warn" />תשלומים שלא שולמו</span>} description="למפגשים שכבר התקיימו" padded={false} className="border-s-[3px] border-s-warn">
              <ul className="divide-y divide-edge">
                {(allUnpaid ? unpaidList : unpaidList.slice(0, CAP)).map((p) => (
                  <li key={p.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{p.supplier}{p.description && <span className="font-normal text-ink-soft"> · {p.description}</span>}</p>
                      <p className="text-small text-muted"><MeetingLink event={{ ...p.event, type: 'other', status: 'completed' }} />{!p.invoice_received && <> · עוד אין חשבונית</>}</p>
                    </div>
                    <Badge tone="warn" icon="alert"><span className="num">{fmtMoney(p.amount)}</span></Badge>
                  </li>
                ))}
              </ul>
              {unpaidList.length > CAP && <More open={allUnpaid} total={unpaidList.length} onToggle={() => setAllUnpaid((v) => !v)} />}
            </Panel>
          )}
        </div>
      )}

      {week.isError ? <ErrorBox error={errorMessage(week.error)} onRetry={() => week.refetch()} /> : week.isLoading ? <Panel><Skeleton lines={8} /></Panel> : (
        <ol className="flex flex-col gap-3" aria-label="ימי השבוע">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((day, i) => {
            const list = byDay.get(day) ?? [];
            const isToday = day === today;
            const dayHours = sumHours(list);
            return (
              <li key={day} aria-label={`יום ${WEEKDAY_NAME[i]} ${dm(day)}`} className={cx('rounded-[var(--radius-panel)] border bg-paper', isToday ? 'border-ink' : 'border-edge', !list.length && 'bg-transparent')}>
                <h3 className={cx('flex items-center justify-between gap-2 px-4 sm:px-5', list.length ? 'py-2.5' : 'py-2', isToday ? 'bg-ink text-light' : list.length ? 'border-b border-edge' : '')}>
                  <span className={cx('font-bold', !list.length && !isToday && 'font-medium text-muted')}>
                    יום {WEEKDAY_NAME[i]} <span className="num font-medium">{dm(day)}</span>
                    {isToday && <span className="ms-2 text-small font-semibold">· היום</span>}
                  </span>
                  <span className={cx('num text-small', isToday ? 'text-light/80' : 'text-muted')}>
                    {list.length ? `${fmtTotal(dayHours)} ש׳` : 'פנוי'}
                  </span>
                </h3>
                {list.length > 0 && (
                  <ul className="divide-y divide-edge px-4 sm:px-5">
                    {list.map((t) => <TaskLine key={t.id} task={t} meta={meta(t)} />)}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
