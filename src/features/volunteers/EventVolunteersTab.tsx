import type { EventWithStats } from '@/lib/data';

/** The meeting's "מתנדבים" tab: who does what at this meeting. (Being built.) */
export function EventVolunteersTab({ event }: { event: EventWithStats }) {
  return <p className="text-muted">מתנדבים במפגש {event.title}</p>;
}
