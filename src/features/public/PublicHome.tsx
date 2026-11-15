import { Link, useSearchParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { EmptyState, ErrorBox, Skeleton, buttonClass } from '@/ui/kit';
import { Tri } from '@/ui/Shapes';
import { usePublicEvents } from './api';
import { EventTicket } from './EventTicket';
import { trackingQuery } from './tracking';
import { Hero } from './Hero';
import running from '@/assets/photos/running.webp';

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
      <Hero photo={running} position="50% 30%" kicker="בואו איתנו" title="להמשיך תנועה">
        מפגשי שישי ללוחמים וללוחמות: יוגה, הרצאת אורח, ארוחת בוקר וזמן ביחד.
      </Hero>

      <h2 className="mt-8 font-display text-[1.6rem] leading-tight">המפגשים הקרובים</h2>
      <p className="mt-1 text-[1.02rem] text-ink-soft">ההרשמה לוקחת פחות מדקה.</p>

      <div className="mt-5">
        {events.isPending ? (
          <Skeleton lines={6} />
        ) : events.isError ? (
          <ErrorBox error={errorMessage(events.error)} onRetry={() => events.refetch()} />
        ) : events.data.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] bg-paper">
            <EmptyState icon="calendar" title="אין כרגע מפגשים פתוחים להרשמה">
              המפגש הבא יפורסם בקרוב באינסטגרם ובקבוצות הוואטסאפ של העמותה. נשמח לראות אתכם!
            </EmptyState>
          </div>
        ) : (
          <ul className="flex flex-col gap-5" aria-label="מפגשים פתוחים להרשמה">
            {events.data.map((e, i) => (
              <li key={e.code}>
                <Link
                  to={`/r/${e.code}${query}`}
                  className="group block rounded-[var(--radius-panel)] transition-transform active:scale-[0.99]"
                >
                  <EventTicket event={e} highlight={i === 0} showStatus="notable">
                    <span className={buttonClass(i === 0 ? 'primary' : 'secondary', 'md', 'mt-4 w-full sm:w-auto group-hover:bg-tide-deep group-hover:text-light')}>
                      {cta(e)}
                      <Tri className="ms-1" />
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
