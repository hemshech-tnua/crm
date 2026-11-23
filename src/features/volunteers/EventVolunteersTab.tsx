import { errorMessage } from '@/lib/errors';
import type { EventWithStats } from '@/lib/data';
import { ButtonLink, ErrorBox, Notice, Panel, Skeleton } from '@/ui/kit';
import { PendingLinks, Reminders, VolunteerActions } from './actions';
import { isUpcoming, type PlanEvent } from './model';
import { usePlanEvents, useShifts, useVolunteers } from './queries';
import { MeetingCard } from './slots';

/** The meeting's "מתנדבים" tab: the same slots as the planner, for this one meeting. */
export function EventVolunteersTab({ event }: { event: EventWithStats }) {
  const volunteers = useVolunteers();
  const events = usePlanEvents();
  const all = useShifts();
  const here = useShifts(event.id);
  const failed = volunteers.error ?? events.error ?? all.error ?? here.error;
  // a failed background refetch keeps the loaded tab: the error shows only while something has not loaded yet
  if (failed && !(volunteers.data && events.data && all.data && here.data)) {
    return <ErrorBox error={errorMessage(failed)} onRetry={() => { void volunteers.refetch(); void events.refetch(); void all.refetch(); void here.refetch(); }} />;
  }
  if (!volunteers.data || !events.data || !all.data || !here.data) return <Skeleton shape="block" height={260} />;

  const e: PlanEvent = { id: event.id, title: event.title, type: event.type, starts_at: event.starts_at, ends_at: event.ends_at, location: event.location, status: event.status };
  // this meeting's shifts may be older than the planner's window: keep them in the shared list the dialogs read
  const shifts = [...all.data.filter((s) => s.event_id !== event.id), ...here.data];
  const upcoming = isUpcoming(e);

  return (
    <VolunteerActions data={{ volunteers: volunteers.data, events: events.data, shifts }}>
      <div className="flex flex-col gap-4">
        {event.status === 'cancelled' && <Notice tone="warn" icon="alert">המפגש בוטל. כדאי לבטל את השיבוצים ולעדכן את המתנדבים.</Notice>}
        <div className={upcoming ? 'grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}>
          <MeetingCard event={e} shifts={here.data} showLink={false} />
          {upcoming && (
            <Panel>
              <div className="flex flex-col gap-4">
                <Reminders shifts={here.data} />
                <PendingLinks shifts={here.data} />
                {!here.data.some((s) => s.status === 'invited' || s.status === 'confirmed') && (
                  <p className="text-small text-muted">לחיצה על "+ שיבוץ" פותחת את רשימת המתנדבים. משבצים את כל התפקידים של המפגש בלי לסגור את החלון, ואפשר לשבץ את אותו אדם גם למפגשים הבאים בבת אחת.</p>
                )}
                <div>
                  <ButtonLink to="/app/volunteers" variant="ghost" size="sm" icon="calendar" className="-ms-3">כל המפגשים הקרובים בשיבוץ</ButtonLink>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </VolunteerActions>
  );
}
