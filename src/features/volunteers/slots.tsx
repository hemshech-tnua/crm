// The slots of a meeting (who does what) as a dense table row on a desktop and as a card on a phone.
import { Link } from 'react-router';
import { TZ, fmtMonth, fmtShortDate, fmtTime, relativeDays } from '@/lib/dates';
import { EVENT_TYPE_LABEL } from '@/lib/labels';
import type { VolunteerRole } from '@/lib/types';
import { Badge, Td, Th, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { ReminderLink, StatusBadge, useVolunteerActions } from './actions';
import { ROLE_LABEL, ROLE_ORDER, SLOTS, dayAndDate, isSoon, remindable, shortDay, slotsFor, type PlanEvent, type Shift, type Slot } from './model';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'short' });

/** The people in one slot (each opens its shift) and, while it is not full, the "חסר" button that assigns. */
export function SlotBody({ event, slot, compact }: { event: PlanEvent; slot: Slot; compact?: boolean }) {
  const { assign, manage, volunteer } = useVolunteerActions();
  const where = `${slot.def.label} ב${event.title}, ${dayAndDate(event.starts_at)}`;
  return (
    <div className="flex flex-col gap-1">
      {slot.shifts.map((s) => {
        const v = volunteer(s.volunteer_id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => manage(s)}
            className={cx(
              'flex min-h-11 w-full rounded-[var(--radius-control)] border border-transparent px-2 py-1 text-start transition-colors hover:border-ink/40 hover:bg-ink/[0.03]',
              compact ? 'flex-row flex-wrap items-center gap-x-2.5 gap-y-0.5' : 'flex-col items-start justify-center gap-0.5',
            )}
          >
            <span className={cx('max-w-full truncate font-medium', s.status === 'declined' && 'text-muted line-through decoration-1')}>
              {v?.full_name ?? '(בלי שם)'}
              <span className="sr-only"> · {where}</span>
            </span>
            <StatusBadge status={s.status} />
          </button>
        );
      })}
      {/* an empty place: a dashed outline that invites, not a warning */}
      {slot.missing > 0 && (
        <button
          type="button"
          onClick={() => assign(event, slot.def)}
          aria-label={`שיבוץ ל${where}${slot.missing > 1 ? ` (${slot.missing} מקומות)` : ''}`}
          className={cx(
            'inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-ink/40 px-3 text-small font-semibold text-ink-soft transition-colors hover:border-ink hover:bg-ink/[0.03] hover:text-ink',
            compact ? 'self-start' : 'w-full',
          )}
        >
          <Icon name="plus" size={15} />
          שיבוץ
          {slot.missing > 1 && <span className="num font-medium text-muted">({slot.missing})</span>}
        </button>
      )}
    </div>
  );
}

/** Ready / missing / waiting, for one meeting (the warning colour only when the meeting is within a week). */
export function MeetingState({ slots, event }: { slots: Slot[]; event?: Pick<PlanEvent, 'starts_at'> }) {
  const missing = slots.reduce((n, s) => n + s.missing, 0);
  const waiting = slots.reduce((n, s) => n + s.filled - s.confirmed, 0);
  if (missing) {
    const text = missing === 1 ? 'חסר 1' : <>חסרים <span className="num">{missing}</span></>;
    return event && !isSoon(event) ? <Badge>{text}</Badge> : <Badge tone="warn" icon="alert">{text}</Badge>;
  }
  if (waiting) return <Badge tone="tide" icon="clock">{waiting === 1 ? 'תשובה 1 חסרה' : <><span className="num">{waiting}</span> מחכים לתשובה</>}</Badge>;
  return <Badge tone="good" icon="check">הכול סגור</Badge>;
}

function TypeLine({ event }: { event: PlanEvent }) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
      <Badge>{EVENT_TYPE_LABEL[event.type]}</Badge>
      {event.status === 'draft' && <Badge tone="tide">טיוטה</Badge>}
    </span>
  );
}

/** The columns of the desktop grid: every role some kind of meeting needs, plus any role already assigned. */
export function gridRoles(shifts: Shift[]): VolunteerRole[] {
  const used = new Set<VolunteerRole>(Object.values(SLOTS).flat().map((d) => d.role));
  for (const s of shifts) used.add(s.role);
  return ROLE_ORDER.filter((r) => used.has(r));
}

/** Desktop: one row per meeting, one column per role ("—" where that kind of meeting does not need it). */
export function PlannerTable({ events, shiftsByEvent, roles }: { events: PlanEvent[]; shiftsByEvent: Map<string, Shift[]>; roles: VolunteerRole[] }) {
  let month = '';
  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-edge bg-paper md:block">
      <table className="w-full border-collapse text-body" aria-label="שיבוץ מתנדבים למפגשים הקרובים">
        <thead>
          <tr>
            <Th className="w-24">תאריך</Th>
            <Th>מפגש</Th>
            {roles.map((r) => <Th key={r} className="min-w-36">{ROLE_LABEL[r]}</Th>)}
            <Th className="w-32">מצב</Th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const slots = slotsFor(e, shiftsByEvent.get(e.id) ?? []);
            const m = fmtMonth(e.starts_at);
            const head = m !== month;
            month = m;
            return [
              head && (
                <tr key={`m-${m}`}>
                  <th colSpan={roles.length + 3} scope="colgroup" className="border-t border-edge bg-mist/40 px-4 py-1.5 text-right text-small font-semibold text-ink-soft">{m}</th>
                </tr>
              ),
              <tr key={e.id} className="align-top">
                <Td className="whitespace-nowrap">
                  <div className="font-semibold">{shortDay(e.starts_at)}</div>
                  <div className="num text-small text-muted">{fmtShortDate(e.starts_at)} · {fmtTime(e.starts_at)}</div>
                </Td>
                <Td className="min-w-44">
                  <Link to={`/app/events/${e.id}?tab=volunteers`} className="font-semibold text-ink hover:underline">{e.title}</Link>
                  <TypeLine event={e} />
                </Td>
                {roles.map((r) => {
                  const slot = slots.find((s) => s.def.role === r);
                  return (
                    <Td key={r} className="px-1.5">
                      {slot ? (
                        <>
                          {slot.def.label !== ROLE_LABEL[r] && <div className="px-2 text-micro text-muted">{slot.def.label}</div>}
                          <SlotBody event={e} slot={slot} />
                        </>
                      ) : (
                        <span className="block px-2 pt-2.5 text-faint" title="לא נדרש במפגש מהסוג הזה">—<span className="sr-only">לא נדרש</span></span>
                      )}
                    </Td>
                  );
                })}
                <Td><div className="pt-2"><MeetingState slots={slots} event={e} /></div></Td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Phone (and the meeting's tab): one card per meeting, one row per role. */
export function MeetingCard({ event, shifts, showLink = true, className = '' }: { event: PlanEvent; shifts: Shift[]; showLink?: boolean; className?: string }) {
  const { volunteer } = useVolunteerActions();
  const slots = slotsFor(event, shifts);
  const due = remindable(event) ? shifts.filter((s) => s.status === 'confirmed') : [];
  const start = new Date(event.starts_at);
  return (
    <article className={cx('overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper', className)}>
      {showLink ? (
        <header className="flex items-stretch border-b border-edge">
          <div className="flex w-16 shrink-0 flex-col items-center justify-center border-e border-edge bg-sky px-1 py-2 text-center text-ink">
            <span className="text-micro font-semibold">{shortDay(event.starts_at)}</span>
            <span className="num font-display text-[1.75rem] leading-none">{dayNum.format(start)}</span>
            <span className="text-micro font-semibold">{monthShort.format(start)}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0">
              <Link to={`/app/events/${event.id}?tab=volunteers`} className="font-semibold text-ink hover:underline">{event.title}</Link>
              <p className="text-small text-muted">
                <span className="num">{fmtTime(event.starts_at)}</span> · {relativeDays(event.starts_at)}{event.location ? ` · ${event.location}` : ''}
              </p>
              <TypeLine event={event} />
            </div>
            <MeetingState slots={slots} event={event} />
          </div>
        </header>
      ) : (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <h2 className="text-heading font-semibold">מי עושה מה</h2>
          <MeetingState slots={slots} event={event} />
        </header>
      )}
      <ul className="divide-y divide-edge">
        {slots.map((s) => (
          <li key={s.def.role} className="flex items-start gap-3 px-3 py-2">
            <span className="w-24 shrink-0 pt-3 text-small font-medium text-ink-soft">{s.def.label}</span>
            <div className="min-w-0 flex-1"><SlotBody event={event} slot={s} compact /></div>
          </li>
        ))}
      </ul>
      {due.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-edge bg-sky-wash px-3 py-2.5">
          <span className="text-small font-medium text-ink-soft">תזכורת:</span>
          {due.map((s) => <ReminderLink key={s.id} shift={s} volunteer={volunteer(s.volunteer_id)} />)}
        </div>
      )}
    </article>
  );
}
