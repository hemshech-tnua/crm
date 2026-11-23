import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDays, ilParts, todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { UNASSIGNED_LABEL } from '@/lib/labels';
import { Badge, Button, ErrorBox, IconButton, Panel, Segmented, Skeleton, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { useAssignees } from '@/features/followups/shared';
import {
  DayShort, OVERDUE_DAYS, Progress, WEEKDAY_LETTER, WEEKDAY_NAME, dm, fmtHours, fmtMoney, fmtTotal, hhmm, isMine, sumHours,
  useMeetingProgress, useOverdueTasks, useTasksBetween, useTickMany, useWho, weekStart,
  type TaskEvent, type TaskWithEvent, type Who,
} from './shared';
import { Dot, TaskLine } from './TaskLine';
import { useUnpaidPast } from './Payments';

const CAP = 3;
function More({ open, total, onToggle, what = '' }: { open: boolean; total: number; onToggle: () => void; what?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 w-full items-center border-t border-edge px-4 text-small font-semibold text-tide hover:underline sm:px-5">
      {open ? 'הצגת פחות' : what ? <>הצגת כל {what}{' '}(<span className="num">{total}</span>)</> : <>הצגת כל ה־<span className="num">{total}</span></>}
    </button>
  );
}

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const byTime = (a: TaskWithEvent, b: TaskWithEvent) =>
  (hhmm(a.due_time) || '99').localeCompare(hhmm(b.due_time) || '99') || a.event.starts_at.localeCompare(b.event.starts_at) || a.sort_order - b.sort_order;

export function MeetingLink({ event }: { event: TaskEvent }) {
  return (
    // a 24px-high target at least (WCAG 2.5.8): these links sit in dense lists
    <Link to={`/app/events/${event.id}?tab=prep`} className="inline-block min-h-6 py-0.5 font-semibold text-tide hover:underline">
      {event.title}{' '}<span className="font-normal">(<DayShort day={ilParts(event.starts_at).date} />)</span>
    </Link>
  );
}

type Group = { event: TaskEvent; tasks: TaskWithEvent[] };
/** The tasks of a list, meeting by meeting, in the order the meetings first appear. */
function byMeeting(list: TaskWithEvent[]): Group[] {
  const m = new Map<string, Group>();
  for (const t of list) {
    const g = m.get(t.event.id) ?? { event: t.event, tasks: [] };
    g.tasks.push(t);
    m.set(t.event.id, g);
  }
  return [...m.values()];
}

/** One meeting inside a day: its name and how ready it is, then its tasks; the meeting day's own tasks fold away. */
function MeetingGroup({ group, progress, meta, foldDayOf, cap, action }: {
  group: Group; progress?: { done: number; total: number }; meta: (t: TaskWithEvent) => ReactNode;
  foldDayOf?: boolean; cap?: number; action?: ReactNode;
}) {
  const [openDayOf, setOpenDayOf] = useState(false);
  const [all, setAll] = useState(false);
  const meetingDay = ilParts(group.event.starts_at).date;
  const dayOf = foldDayOf ? group.tasks.filter((t) => t.due_date === meetingDay) : [];
  const rest = foldDayOf ? group.tasks.filter((t) => t.due_date !== meetingDay) : group.tasks;
  const shown = cap && !all ? rest.slice(0, cap) : rest;
  const dayOfOpen = dayOf.filter((t) => !t.done_at);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-small"><MeetingLink event={group.event} /></p>
        <div className="flex items-center gap-2">
          {progress && progress.total > 0 && (
            <span className="flex items-center gap-1.5 text-micro text-muted" title="משימות המפגש שבוצעו">
              <span className="num">{progress.done}/{progress.total}</span>
              <Progress value={progress.done / progress.total} label={`מוכנות: ${group.event.title}`} className="w-12" />
            </span>
          )}
          {action}
        </div>
      </div>
      {shown.length > 0 && <ul className="divide-y divide-edge">{shown.map((t) => <TaskLine key={t.id} task={t} meta={meta(t)} />)}</ul>}
      {cap && rest.length > cap && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="inline-flex min-h-11 items-center text-small font-semibold text-tide hover:underline">
          {all ? 'הצגת פחות' : <>ועוד <span className="num mx-1">{rest.length - cap}</span> במפגש הזה</>}
        </button>
      )}
      {dayOf.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpenDayOf((v) => !v)}
            aria-expanded={openDayOf}
            className="flex min-h-11 w-full items-center gap-2 text-start text-small text-ink-soft hover:text-ink"
          >
            <Icon name="chevron" size={16} className={cx('shrink-0 transition-transform', openDayOf && '-rotate-90')} />
            <span className="font-semibold">ביום המפגש</span>
            <span className="text-muted">
              <span className="num">{dayOf.length}</span> {dayOf.length === 1 ? 'משימה' : 'משימות'}
              {sumHours(dayOfOpen) > 0 && <> · <span className="num">{fmtTotal(sumHours(dayOfOpen))}</span> ש׳</>}
              {dayOfOpen.length === 0 && ' · בוצעו'}
            </span>
          </button>
          {openDayOf && <ul className="divide-y divide-edge">{dayOf.map((t) => <TaskLine key={t.id} task={t} meta={meta(t)} />)}</ul>}
        </>
      )}
    </li>
  );
}

/** "השבוע שלי": today first (with what was left open before it), then the rest of the week, meeting by meeting. */
export function WeekView() {
  const [sp, setSp] = useSearchParams();
  const today = todayIl();
  const thisWeek = weekStart(today);
  const from = isDay(sp.get('week')) ? weekStart(sp.get('week')!) : thisWeek;
  const to = addDays(from, 6);
  const go = (w: string) => setSp(w === thisWeek ? {} : { week: w }, { replace: true });
  const isThisWeek = from === thisWeek;
  const [who, setWho, myId] = useWho();

  const week = useTasksBetween(from, to);
  const overdue = useOverdueTasks();
  const unpaid = useUnpaidPast();
  const tickMany = useTickMany();
  const { name: staffName } = useAssignees();

  const keep = useMemo(() => (who === 'team' ? () => true : (t: TaskWithEvent) => isMine(t, myId)), [who, myId]);
  const tasks = useMemo(() => (week.data ?? []).filter(keep), [week.data, keep]);
  const overdueList = useMemo(() => (isThisWeek ? (overdue.data ?? []).filter(keep) : []), [isThisWeek, overdue.data, keep]);
  // the latest first (the query's order): what was left open yesterday matters more than what was left a month ago
  const overdueGroups = useMemo(() => byMeeting(overdueList), [overdueList]);
  const byDay = useMemo(() => {
    const m = new Map<string, TaskWithEvent[]>();
    for (const t of tasks) m.set(t.due_date!, [...(m.get(t.due_date!) ?? []), t]);
    for (const list of m.values()) list.sort(byTime);
    return m;
  }, [tasks]);
  const progress = useMeetingProgress([...tasks, ...overdueList].map((t) => t.event.id));
  const open = tasks.filter((t) => !t.done_at);
  const planned = sumHours(tasks);
  const left = sumHours(open);
  const unpaidList = unpaid.data ?? [];
  const [allUnpaid, setAllUnpaid] = useState(false);
  const [showOverdue, setShowOverdue] = useState<boolean | null>(null);
  const overdueOpen = showOverdue ?? overdueList.length <= CAP;
  const [allOverdueMeetings, setAllOverdueMeetings] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const meta = (t: TaskWithEvent, withDate = false) => {
    const facts = [
      withDate && t.due_date ? <DayShort key="d" day={t.due_date} className="font-semibold text-warn" /> : null,
      !withDate && t.due_time ? <span key="t" className="num font-semibold text-ink">{hhmm(t.due_time)}</span> : null,
      t.hours ? <span key="h">{fmtHours(t.hours)}</span> : null,
      who === 'team' ? <span key="a">{t.assignee_id ? staffName.get(t.assignee_id) ?? 'צוות' : UNASSIGNED_LABEL}</span>
        : t.assignee_id ? <span key="a">עליך</span> : null,
    ].filter(Boolean);
    return facts.flatMap((f, i) => (i ? [<Dot key={`dot${i}`} />, f] : [f]));
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const upcoming = isThisWeek ? days.filter((d) => d > today) : days;
  const past = isThisWeek ? days.filter((d) => d < today) : [];
  const pastTasks = past.flatMap((d) => byDay.get(d) ?? []);

  const dayItem = (day: string, kind: 'today' | 'day') => {
    const i = days.indexOf(day);
    const list = byDay.get(day) ?? [];
    const isToday = kind === 'today';
    const dayHours = sumHours(list);
    const groups = byMeeting(list);
    return (
      <li key={day} aria-label={`יום ${WEEKDAY_NAME[i]} ${dm(day)}`} className={cx('rounded-[var(--radius-panel)] border bg-paper', isToday ? 'border-ink' : 'border-edge', !list.length && !isToday && 'bg-transparent')}>
        <h3 className={cx('flex items-center justify-between gap-2 px-4 sm:px-5', list.length || isToday ? 'py-2.5' : 'py-2', isToday ? 'bg-ink text-light' : list.length ? 'border-b border-edge' : '')}>
          <span className={cx('font-bold', !list.length && !isToday && 'font-medium text-muted')}>
            {isToday && <span className="me-2">היום ·</span>}
            יום {WEEKDAY_NAME[i]} <span className="num font-medium">{dm(day)}</span>
          </span>
          <span className={cx('num text-small', isToday ? 'text-light/80' : 'text-muted')}>
            {list.length ? `${fmtTotal(dayHours)} ש׳` : isToday ? '' : 'פנוי'}
          </span>
        </h3>
        {groups.length > 0 && (
          <ul className="divide-y divide-edge px-4 sm:px-5">
            {groups.map((g) => <MeetingGroup key={g.event.id} group={g} progress={progress.data?.get(g.event.id)} meta={meta} foldDayOf={!isToday} />)}
          </ul>
        )}
        {isToday && !list.length && (
          <p className="px-4 py-3 text-small text-muted sm:px-5">{who === 'mine' ? 'אין לך משימות הכנה להיום.' : 'אין משימות הכנה להיום.'}</p>
        )}
        {isToday && overdueList.length > 0 && (
          <div className="border-t border-edge">
            <button
              type="button"
              onClick={() => setShowOverdue(!overdueOpen)}
              aria-expanded={overdueOpen}
              className="flex min-h-12 w-full items-center gap-2 px-4 text-start font-semibold text-warn hover:underline sm:px-5"
            >
              <Icon name="alert" size={18} className="shrink-0" />
              <span className="flex-1">
                מהימים הקודמים
                <span className="font-medium"> · {overdueList.length === 1 ? 'משימה אחת' : <><span className="num">{overdueList.length}</span> משימות</>}
                  {overdueGroups.length > 1 && <> ב־<span className="num">{overdueGroups.length}</span> מפגשים</>}</span>
              </span>
              <Icon name="chevron" size={16} className={cx('shrink-0 transition-transform', overdueOpen && '-rotate-90')} />
            </button>
            {overdueOpen && (
              <>
                <p className="px-4 text-small text-muted sm:px-5">משימות באיחור שעוד לא סומנו (עד <span className="num">{OVERDUE_DAYS}</span> ימים אחורה). אם כבר נעשו, מסמנים וזהו.</p>
                <ul className="divide-y divide-edge px-4 sm:px-5" aria-label="מהימים הקודמים">
                  {(allOverdueMeetings ? overdueGroups : overdueGroups.slice(0, CAP)).map((g) => (
                    <MeetingGroup
                      key={g.event.id}
                      group={g}
                      progress={progress.data?.get(g.event.id)}
                      meta={(t) => meta(t, true)}
                      cap={CAP}
                      action={g.tasks.length > 1 && (
                        <Button size="sm" variant="ghost" icon="check" disabled={tickMany.isPending} onClick={() => tickMany.mutate(g.tasks.map((t) => t.id))}
                          aria-label={`סימון ${g.tasks.length} המשימות של ${g.event.title} כבוצעו`}>
                          סימון כולן כבוצעו
                        </Button>
                      )}
                    />
                  ))}
                </ul>
                {overdueGroups.length > CAP && <More open={allOverdueMeetings} total={overdueGroups.length} what="המפגשים" onToggle={() => setAllOverdueMeetings((v) => !v)} />}
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* the week navigator, whose tasks, and the total */}
      <div className="flex flex-col gap-2">
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
          <Segmented<Who>
            label="של מי המשימות"
            value={who}
            onChange={setWho}
            options={[{ value: 'mine', label: 'שלי' }, { value: 'team', label: 'כל הצוות' }]}
          />
        </div>
        {week.data && (
          <p className="text-small text-muted" aria-live="polite">
            {tasks.length ? (
              <>
                <span className="num font-bold text-ink">{fmtTotal(planned)}</span> שעות מתוכננות
                {open.length > 0 && open.length < tasks.length && <> · נותרו <span className="num font-bold text-ink">{fmtTotal(left)}</span></>}
                {' · '}<span className="num">{tasks.length - open.length}/{tasks.length}</span> בוצעו
              </>
            ) : 'אין משימות הכנה בשבוע הזה'}
            {who === 'mine' && <> · כולל משימות בלי אחראי</>}
          </p>
        )}
      </div>

      {week.isError && !week.data ? <ErrorBox error={errorMessage(week.error)} onRetry={() => week.refetch()} /> : week.isLoading ? <Skeleton shape="rows" count={4} height={120} /> : (
        <ol className="flex flex-col gap-3" aria-label="ימי השבוע">
          {isThisWeek && dayItem(today, 'today')}
          {upcoming.map((d) => dayItem(d, 'day'))}
          {past.length > 0 && (
            <li className="rounded-[var(--radius-panel)] border border-edge">
              <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="flex min-h-11 w-full items-center gap-2 px-4 text-start text-small sm:px-5">
                <Icon name="chevron" size={16} className={cx('shrink-0 transition-transform', showPast && '-rotate-90')} />
                <span className="font-semibold text-ink-soft">מוקדם יותר השבוע</span>
                <span className="text-muted">
                  {WEEKDAY_LETTER[0]}–{WEEKDAY_LETTER[past.length - 1]}
                  {pastTasks.length > 0 && <> · <span className="num">{pastTasks.filter((t) => t.done_at).length}/{pastTasks.length}</span> בוצעו</>}
                </span>
              </button>
              {showPast && <ol className="flex flex-col gap-3 p-3 pt-0" aria-label="ימים שעברו השבוע">{past.map((d) => dayItem(d, 'day'))}</ol>}
            </li>
          )}
        </ol>
      )}

      {unpaidList.length > 0 && (
        <Panel title="תשלומים לספקים שעוד לא שולמו" description="למפגשים שכבר התקיימו" padded={false}>
          <ul className="divide-y divide-edge">
            {(allUnpaid ? unpaidList : unpaidList.slice(0, CAP)).map((p) => (
              <li key={p.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.supplier}{p.description && <span className="font-normal text-ink-soft"> · {p.description}</span>}</p>
                  <p className="text-small text-muted"><MeetingLink event={{ ...p.event, type: 'other', status: 'completed' }} />{!p.invoice_received && <> · עוד אין חשבונית</>}</p>
                </div>
                <Badge><span className="num">{fmtMoney(p.amount)}</span></Badge>
              </li>
            ))}
          </ul>
          {unpaidList.length > CAP && <More open={allUnpaid} total={unpaidList.length} onToggle={() => setAllUnpaid((v) => !v)} />}
        </Panel>
      )}
    </div>
  );
}
