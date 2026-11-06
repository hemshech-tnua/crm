import { Link, useSearchParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { EmptyState, ErrorBox, Skeleton, buttonClass } from '@/ui/kit';
import { usePublicEvents } from './api';
import { EventTicket } from './EventTicket';
import { trackingQuery } from './tracking';

function cta(e: PublicEvent): string {
  if (!e.registration_open) return 'לפרטים';
  if (e.is_full) return e.waitlist_enabled ? 'להצטרפות לרשימת ההמתנה' : 'לפרטים';
  return 'להרשמה';
}

export function PublicHome() {
  const [params] = useSearchParams();
  const query = trackingQuery(params);
  const events = usePublicEvents();

  return (
    <div>
      <h1 className="font-display text-[1.9rem] leading-tight">המפגשים הקרובים</h1>
      <p className="mt-1.5 text-[1.05rem] text-ink-soft">יוגה, הרצאת אורח, ארוחת בוקר וזמן ביחד. ההרשמה לוקחת פחות מדקה.</p>

      <div className="mt-6">
        {events.isPending ? (
          <Skeleton lines={6} />
        ) : events.isError ? (
          <ErrorBox error={errorMessage(events.error)} onRetry={() => events.refetch()} />
        ) : events.data.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] bg-paper">
            <EmptyState icon="calendar" title="אין כרגע מפגשים פתוחים להרשמה">
              המפגש הבא יפורסם בקרוב באינסטגרם ובקבוצות הוואטסאפ של העמותה. נשמח לראות אותך!
            </EmptyState>
          </div>
        ) : (
          <ul className="flex flex-col gap-5" aria-label="מפגשים פתוחים להרשמה">
            {events.data.map((e, i) => (
              <li key={e.code}>
                <Link
                  to={`/r/${e.code}${query}`}
                  aria-label={`${cta(e)}: ${e.title}, ${fmtDayLong(e.starts_at)}`}
                  className="group block rounded-[var(--radius-panel)] transition-transform active:scale-[0.99]"
                >
                  <EventTicket event={e} highlight={i === 0}>
                    <span className={buttonClass(i === 0 ? 'primary' : 'secondary', 'md', 'mt-4 w-full sm:w-auto group-hover:bg-tide-deep group-hover:text-white')}>
                      {cta(e)}
                    </span>
                  </EventTicket>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
