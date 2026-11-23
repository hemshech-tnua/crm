import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { can, useMe, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { fmtDayLong, fmtTime, ilParts, todayIl } from '@/lib/dates';
import { Badge, ButtonLink, EmptyState, ErrorBox, PageHeader, Panel, Skeleton, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { Tri } from '@/ui/Shapes';
import { eventKeys, fetchCheckinList, useDoorEvents, type DoorEvent } from './queries';
import { StatusBadge, TypeBadge, inDoorWindow, timeRange } from './shared';

const WINDOW = 12 * 3600_000;
const inWindow = (e: DoorEvent, now: number) => inDoorWindow(e, now);
/** From two hours before the start until the end: the meeting the door is working on now. */
const isLive = (e: DoorEvent, now: number) => now >= new Date(e.starts_at).getTime() - 2 * 3600_000 && now <= new Date(e.ends_at).getTime();

export function DoorHome() {
  const role = useRole();
  const me = useMe();
  const q = useDoorEvents();
  const now = Date.now();
  const today = todayIl();
  const list = (q.data?.around ?? []).filter((e) => ilParts(e.starts_at).date === today || inWindow(e, now));
  const first = me.data?.full_name?.split(' ')[0];
  // what the door needs now comes first: the meeting happening now, then the next ones today;
  // meetings that already ended or were cancelled wait under one line, so nobody opens the wrong list
  const done = (e: DoorEvent) => e.status === 'cancelled' || new Date(e.ends_at).getTime() < now;
  const rank = (e: DoorEvent) => (isLive(e, now) ? 0 : 1);
  const current = list.filter((e) => !done(e)).sort((a, b) => rank(a) - rank(b) || a.starts_at.localeCompare(b.starts_at));
  const past = list.filter(done);
  const [showPast, setShowPast] = useState(false);

  return (
    <>
      <PageHeader
        title={first ? `שלום, ${first}` : 'כניסה'}
        subtitle={<span>{fmtDayLong(new Date())} · המפגשים של היום</span>}
        actions={can.manage(role) ? <ButtonLink to="/app/events" variant="secondary" icon="calendar">כל המפגשים</ButtonLink> : undefined}
      />
      {q.isLoading ? (
        <Skeleton shape="tiles" count={1} height={236} cols="grid-cols-1" />
      ) : q.isError && !q.data ? (
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
        <div className="flex flex-col gap-4">
          {current.length > 0 ? (
            <ul className="flex flex-col gap-4">
              {current.map((e) => <DoorCard key={e.id} e={e} now={now} manager={can.manage(role)} />)}
            </ul>
          ) : (
            <Panel>
              <EmptyState icon="sun" title="אין עוד מפגשים היום">
                {q.data?.next ? (
                  <>המפגש הבא: <b>{q.data.next.title}</b>, {fmtDayLong(q.data.next.starts_at)} בשעה <span className="num">{fmtTime(q.data.next.starts_at)}</span>.</>
                ) : null}
              </EmptyState>
            </Panel>
          )}
          {past.length > 0 && (
            <section>
              <button
                type="button"
                aria-expanded={showPast}
                onClick={() => setShowPast((v) => !v)}
                className="flex h-12 w-full items-center justify-between rounded-[var(--radius-control)] px-1 text-right font-bold text-muted"
              >
                <span>הסתיימו או בוטלו <span className="num font-normal">({past.length})</span></span>
                <Icon name="chevron" className={cx('transition-transform', showPast && '-rotate-90')} />
              </button>
              {showPast && (
                <ul className="mt-1 flex flex-col gap-4">
                  {past.map((e) => <DoorCard key={e.id} e={e} now={now} manager={can.manage(role)} />)}
                </ul>
              )}
            </section>
          )}
        </div>
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
  const live = isLive(e, now);
  const notYet = rows.filter((r) => r.status === 'registered' && r.attendance !== 'attended').length;

  const body = (
    <div className={cx('rounded-[var(--radius-panel)] border bg-paper p-5 transition-colors', live && !cancelled ? 'border-ink' : 'border-edge', open && !cancelled && 'hover:border-ink')}>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={e.type} />
        {live && !cancelled ? <Badge tone="light">עכשיו</Badge> : <StatusBadge status={e.status} endsAt={e.ends_at} />}
      </div>
      <div className="mt-2 text-section font-bold">{e.title}</div>
      <div className="mt-1 text-ink-soft">
        {fmtDayLong(e.starts_at)} · <span className="num">{timeRange(e)}</span>
      </div>
      {e.location && <div className="text-small text-muted">{e.location}</div>}
      {open && !cancelled && counts.data && (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="num font-display text-stat leading-none">{arrived}</span>
            <span className="font-medium text-ink-soft">הגיעו</span>
          </div>
          <p className="mt-1 text-small text-ink-soft">
            {notYet === 1 ? <><span className="font-semibold text-ink">אחד</span> עוד לא הגיע</> : <><span className="num font-semibold text-ink">{notYet}</span> עוד לא הגיעו</>}
            {' · '}{registered === 1 ? 'רשום אחד' : <><span className="num">{registered}</span> רשומים</>}
          </p>
        </div>
      )}
      <div className="mt-4">
        {cancelled ? (
          <p className="font-semibold text-bad">המפגש בוטל.</p>
        ) : open ? (
          <span className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-tide text-heading font-semibold text-light">
            <Icon name="door" />
            פתיחת רשימת הנוכחות
            <Tri className="ms-1" />
          </span>
        ) : (
          <p className="text-muted">הרשימה תיפתח בשעה <span className="num">{fmtTime(new Date(new Date(e.starts_at).getTime() - WINDOW))}</span>.</p>
        )}
      </div>
    </div>
  );

  return <li>{open && !cancelled ? <Link to={`/app/events/${e.id}/door`} className="block">{body}</Link> : body}</li>;
}
