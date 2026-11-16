import { Link, useSearchParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, fmtDayLong, relativeDays } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { Badge, ButtonLink, EmptyState, ErrorBox, Skeleton } from '@/ui/kit';
import { Tri } from '@/ui/Shapes';
import { usePublicEvents } from './api';
import { EventTicket, availability } from './EventTicket';
import { activityText, lectureText, timeRange } from './eventText';
import { trackingQuery } from './tracking';
import { Hero } from './Hero';
import hills from '@/assets/photos/hills.webp';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'short' });

function cta(e: PublicEvent): string {
  if (!e.registration_open) return 'לפרטים';
  if (e.is_full) return e.waitlist_enabled ? 'להצטרפות לרשימת ההמתנה' : 'לפרטים';
  return 'להרשמה';
}

export function PublicHome() {
  const [params] = useSearchParams();
  const query = trackingQuery(params);
  const events = usePublicEvents();
  const [next, ...rest] = events.data ?? [];

  return (
    <div>
      <Hero photo={hills} position="50% 62%" kicker="בואו איתנו" title="להמשיך תנועה">
        מפגשי שישי ללוחמים וללוחמות: יוגה, הרצאת אורח, ארוחת בוקר וזמן ביחד.
      </Hero>

      <div className="mt-5 sm:mt-8 lg:mt-10">
        {events.isPending ? (
          <Skeleton lines={6} />
        ) : events.isError ? (
          <ErrorBox error={errorMessage(events.error)} onRetry={() => events.refetch()} />
        ) : !next ? (
          <div className="rounded-[var(--radius-panel)] border border-edge bg-paper">
            <EmptyState icon="calendar" title="אין כרגע מפגשים פתוחים להרשמה">
              המפגש הבא יפורסם בקרוב באינסטגרם ובקבוצות הוואטסאפ של העמותה. נשמח לראות אתכם!
            </EmptyState>
          </div>
        ) : (
          <div className={rest.length ? 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-10' : 'lg:max-w-xl'}>
            <section aria-labelledby="next-meeting" className="lg:sticky lg:top-6">
              <h2 id="next-meeting" className="mb-2.5 text-heading font-semibold">המפגש הקרוב</h2>
              <EventTicket event={next} highlight level={3} showStatus="notable" className="relative">
                <ButtonLink
                  to={`/r/${next.code}${query}`}
                  cta
                  className="mt-4 w-full after:absolute after:inset-0 after:content-[''] sm:w-auto"
                >
                  {cta(next)}
                  <span className="sr-only">: {next.title}, {fmtDayLong(next.starts_at)}</span>
                </ButtonLink>
                {cta(next) === 'להרשמה' && <p className="mt-2 text-small text-muted">ההרשמה לוקחת פחות מדקה.</p>}
              </EventTicket>
            </section>
            {rest.length > 0 && (
              <section aria-labelledby="more-meetings">
                <h2 id="more-meetings" className="mb-2.5 text-heading font-semibold">עוד מפגשים</h2>
                <ul className="divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper">
                  {rest.map((e) => <ScheduleRow key={e.code} event={e} to={`/r/${e.code}${query}`} label={cta(e)} />)}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One meeting in the schedule (book p.63: date, what, the triangle). The whole row is the link; its name is the title
 * and the date, so a screen reader tells the rows apart even when the titles repeat.
 */
function ScheduleRow({ event: e, to, label }: { event: PublicEvent; to: string; label: string }) {
  const start = new Date(e.starts_at);
  const status = availability(e);
  const what = lectureText(e) ?? activityText(e);
  return (
    <li className="relative flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-mist/70 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:-outline-offset-3 has-[a:focus-visible]:outline-ink">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">
          <Link to={to} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {e.title}
            <span className="sr-only">, {fmtDayLong(start)}. {label}</span>
          </Link>
        </h3>
        <p className="mt-0.5 text-small text-muted">
          <span className="num">{timeRange(e)}</span> · {relativeDays(start)}
        </p>
        {e.location && <p className="text-small text-muted">{e.location}</p>}
        {what && <p className="mt-0.5 truncate text-small text-ink-soft">{what}</p>}
        {!status.plain && <div className="mt-1.5"><Badge tone={status.tone}>{status.text}</Badge></div>}
      </div>
      <div className="order-first flex w-14 shrink-0 flex-col items-center text-center" aria-hidden="true">
        <span className="text-micro font-medium text-ink-soft">{fmtDay(start)}</span>
        <span className="num font-display text-[1.75rem] leading-none">{dayNum.format(start)}</span>
        <span className="text-micro font-medium text-ink-soft">{monthShort.format(start)}</span>
      </div>
      <Tri className="shrink-0 text-ink" size="0.8em" />
    </li>
  );
}
