import { Link } from 'react-router';
import { todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { Badge, ErrorBox, Panel, Skeleton } from '@/ui/kit';
import { DayShort, fmtHours, hhmm, useOverdueTasks, useTasksBetween } from './shared';
import { Dot, TaskLine } from './TaskLine';
import { MeetingLink } from './WeekView';

const MAX = 5;

/** Dashboard: today's and overdue preparation tasks, at most five, tickable in place. */
export function MyWeekPanel({ className = '' }: { className?: string }) {
  const today = todayIl();
  const todays = useTasksBetween(today, today);
  const overdue = useOverdueTasks();
  const loading = todays.isLoading || overdue.isLoading;
  const error = todays.error ?? overdue.error;
  // today's first (by hour), then what is overdue, the most recent first
  const list = [...(todays.data ?? []).filter((t) => !t.done_at).sort((a, b) => (hhmm(a.due_time) || '99').localeCompare(hhmm(b.due_time) || '99')), ...[...(overdue.data ?? [])].reverse()];
  const shown = list.slice(0, MAX);

  return (
    <Panel
      title="השבוע שלי"
      className={className}
      padded={false}
      actions={<Link to="/app/prep" className="-my-2 inline-flex min-h-11 items-center text-small font-semibold text-tide hover:underline">לכל ההכנות</Link>}
    >
      {error ? <div className="p-4"><ErrorBox error={errorMessage(error)} /></div> : loading ? <div className="p-4"><Skeleton lines={3} /></div> : !list.length ? (
        <p className="px-4 py-3 text-small text-muted sm:px-5">אין משימות הכנה להיום, ואין משימות באיחור.</p>
      ) : (
        <>
          <ul className="divide-y divide-edge px-4 sm:px-5">
            {shown.map((t) => {
              const late = t.due_date! < today;
              return (
                <TaskLine
                  key={t.id}
                  task={t}
                  meta={<>
                    {late ? <Badge tone="warn" icon="alert">באיחור · <DayShort day={t.due_date!} /></Badge> : <span className="font-semibold text-ink">היום{t.due_time ? <span className="num"> {hhmm(t.due_time)}</span> : ''}</span>}
                    <Dot /><MeetingLink event={t.event} />
                    {t.hours ? <><Dot /><span>{fmtHours(t.hours)}</span></> : null}
                  </>}
                />
              );
            })}
          </ul>
          {list.length > MAX && <p className="border-t border-edge px-4 py-2 text-small text-muted sm:px-5">ועוד <span className="num">{list.length - MAX}</span> במסך ההכנות</p>}
        </>
      )}
    </Panel>
  );
}
