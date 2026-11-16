import type { EventWithStats } from '@/lib/data';

/** The meeting's "הכנות" tab: checklist, equipment and payments. (Being built.) */
export function EventPrepTab({ event }: { event: EventWithStats }) {
  return <p className="text-muted">הכנות למפגש {event.title}</p>;
}
