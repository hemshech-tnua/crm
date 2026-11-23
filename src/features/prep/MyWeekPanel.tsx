import { Link } from 'react-router';
import { addDays, todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { ErrorBox, Panel, Skeleton } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { DayShort, fmtHours, hhmm, isMine, useOverdueTasks, useTasksBetween, useWho, type TaskWithEvent } from './shared';
import { Dot, TaskLine } from './TaskLine';
import { MeetingLink } from './WeekView';

const MAX = 3;
const byTime = (a: TaskWithEvent, b: TaskWithEvent) =>
  (a.due_date ?? '').localeCompare(b.due_date ?? '') || (hhmm(a.due_time) || '99').localeCompare(hhmm(b.due_time) || '99') || a.sort_order - b.sort_order;

/**
 * Dashboard: my preparation work in three lines, tickable in place: today's tasks first; on a free day, the next ones
 * of the coming days. What was left open before today is one line that leads to the full screen.
 */
export function MyWeekPanel({ className = '' }: { className?: string }) {
  const today = todayIl();
  const [, , myId] = useWho();
  const ahead = useTasksBetween(today, addDays(today, 6), { openOnly: true });
  const overdue = useOverdueTasks();
  const loading = ahead.isLoading || overdue.isLoading;
  const error = ahead.error ?? overdue.error;
  const mine = (ahead.data ?? []).filter((t) => !t.done_at && isMine(t, myId)).sort(byTime);
  const todays = mine.filter((t) => t.due_date === today);
  // a free day: show what comes next, so the panel always says something useful
  const list = todays.length ? todays : mine;
  const shown = list.slice(0, MAX);
  const late = (overdue.data ?? []).filter((t) => isMine(t, myId)).length;

  return (
    <Panel
      title="השבוע שלי"
      description={!loading && !error ? (todays.length ? <>היום: <span className="num">{todays.length}</span> {todays.length === 1 ? 'משימה' : 'משימות'}</> : 'היום פנוי') : undefined}
      className={className}
      padded={false}
      actions={<Link to="/app/prep" className="-my-2 inline-flex min-h-11 items-center text-small font-semibold text-tide hover:underline">לכל ההכנות</Link>}
    >
      {error ? <div className="p-4"><ErrorBox error={errorMessage(error)} /></div> : loading ? <div className="px-4 py-3 sm:px-5"><Skeleton shape="rows" count={3} height={52} /></div> : !list.length && !late ? (
        <p className="px-4 py-3 text-small text-muted sm:px-5">אין לך משימות הכנה השבוע.</p>
      ) : (
        <>
          {!todays.length && list.length > 0 && <p className="px-4 pt-3 text-small font-semibold text-ink-soft sm:px-5">הבאות בתור</p>}
          {shown.length > 0 && (
            <ul className="divide-y divide-edge px-4 sm:px-5">
              {shown.map((t) => (
                <TaskLine
                  key={t.id}
                  task={t}
                  compact
                  meta={<>
                    {t.due_date === today
                      ? <span className="font-semibold text-ink">היום{t.due_time ? <>{' '}<span className="num">{hhmm(t.due_time)}</span></> : ''}</span>
                      : <DayShort day={t.due_date!} time={t.due_time} className="font-semibold text-ink" />}
                    <Dot /><MeetingLink event={t.event} />
                    {t.hours ? <><Dot /><span>{fmtHours(t.hours)}</span></> : null}
                  </>}
                />
              ))}
            </ul>
          )}
          {(list.length > MAX || late > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 border-t border-edge px-4 sm:px-5">
              {list.length > MAX && (
                <Link to="/app/prep" className="inline-flex min-h-11 items-center text-small font-semibold text-tide hover:underline">
                  ועוד <span className="num mx-1">{list.length - MAX}</span> {todays.length ? 'להיום' : 'השבוע'}
                </Link>
              )}
              {late > 0 && (
                <Link to="/app/prep" className="inline-flex min-h-11 items-center gap-1.5 text-small font-semibold text-warn hover:underline">
                  <Icon name="alert" size={16} />
                  <span>{late === 1 ? 'משימה אחת נשארה פתוחה' : <><span className="num">{late}</span> משימות נשארו פתוחות</>} מהימים הקודמים</span>
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
