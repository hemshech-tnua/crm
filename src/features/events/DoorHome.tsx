import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { can, useMe, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { fmtDayLong, fmtTime, ilParts, todayIl } from '@/lib/dates';
import { Badge, ButtonLink, EmptyState, ErrorBox, PageHeader, Panel, Skeleton, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { eventKeys, fetchCheckinList, useDoorEvents, type DoorEvent } from './queries';
import { StatusBadge, TypeBadge, timeRange } from './shared';

const WINDOW = 12 * 3600_000;

/** Volunteers may open an event's list from 12h before it starts until 12h after it ends (server rule). */
const inWindow = (e: DoorEvent, now: number) =>
  now >= new Date(e.starts_at).getTime() - WINDOW && now <= new Date(e.ends_at).getTime() + WINDOW;

export function DoorHome() {
  const role = useRole();
  const me = useMe();
  const q = useDoorEvents();
  const now = Date.now();
  const today = todayIl();
  const list = (q.data?.around ?? []).filter((e) => ilParts(e.starts_at).date === today || inWindow(e, now));
  const first = me.data?.full_name?.split(' ')[0];

  return (
    <>
      <PageHeader
        title={first ? `שלום, ${first}` : 'כניסה'}
        subtitle={<span>{fmtDayLong(new Date())} · המפגשים של היום</span>}
        actions={can.manage(role) ? <ButtonLink to="/app/events" variant="secondary" icon="calendar">כל המפגשים</ButtonLink> : undefined}
      />
      {q.isLoading ? (
        <Panel><Skeleton lines={4} /></Panel>
      ) : q.isError ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState icon="sun" title="אין מפגש היום">
            {q.data?.next ? (
              <>המפגש הבא: <b>{q.data.next.title}</b>, {fmtDayLong(q.data.next.starts_at)} בשעה <span className="num">{fmtTime(q.data.next.starts_at)}</span>. רשימת הנוכחות תופיע כאן ביום המפגש.</>
            ) : (
              'כשיהיה מפגש, רשימת הנוכחות תופיע כאן ביום המפגש.'
            )}
          </EmptyState>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((e) => <DoorCard key={e.id} e={e} now={now} manager={can.manage(role)} />)}
        </ul>
      )}
    </>
  );
}

function DoorCard({ e, now, manager }: { e: DoorEvent; now: number; manager: boolean }) {
  const open = manager || inWindow(e, now);
  const cancelled = e.status === 'cancelled';
  const counts = useQuery({
    queryKey: eventKeys.checkin(e.id),
    enabled: open && !cancelled,
    refetchInterval: 30_000,
    queryFn: () => fetchCheckinList(e.id),
  });
  const rows = counts.data ?? [];
  const arrived = rows.filter((r) => r.attendance === 'attended').length;
  const registered = rows.filter((r) => r.status === 'registered' && !r.is_walk_in).length;
  const live = now >= new Date(e.starts_at).getTime() - 2 * 3600_000 && now <= new Date(e.ends_at).getTime();

  const body = (
    <div className={cx('rounded-[var(--radius-panel)] border bg-paper p-5 transition-colors', live && !cancelled ? 'border-light' : 'border-line-soft', open && !cancelled && 'hover:border-tide')}>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={e.type} />
        {live && !cancelled ? <Badge tone="light">עכשיו</Badge> : <StatusBadge status={e.status} />}
      </div>
      <div className="mt-2 font-display text-[1.6rem] leading-tight">{e.title}</div>
      <div className="mt-1 text-ink-soft">
        {fmtDayLong(e.starts_at)} · <span className="num">{timeRange(e)}</span>
      </div>
      {e.location && <div className="text-sm text-muted">{e.location}</div>}
      {open && !cancelled && counts.data && (
        <div className="mt-3 flex items-baseline gap-2 text-[1.05rem]">
          <span>הגיעו</span>
          <span className="num font-display text-2xl">{arrived}</span>
          <span className="text-muted">· רשומים</span>
          <span className="num font-display text-2xl text-ink-soft">{registered}</span>
        </div>
      )}
      <div className="mt-4">
        {cancelled ? (
          <p className="font-semibold text-bad">המפגש בוטל.</p>
        ) : open ? (
          <span className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-tide text-lg font-semibold text-white">
            <Icon name="door" />
            פתיחת רשימת הנוכחות
          </span>
        ) : (
          <p className="text-muted">הרשימה תיפתח ב-<span className="num">{fmtTime(new Date(new Date(e.starts_at).getTime() - WINDOW))}</span>.</p>
        )}
      </div>
    </div>
  );

  return <li>{open && !cancelled ? <Link to={`/app/events/${e.id}/door`} className="block">{body}</Link> : body}</li>;
}
