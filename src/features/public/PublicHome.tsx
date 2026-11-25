import { Link, useSearchParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, fmtDayLong, relativeDays } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { Badge, ButtonLink, EmptyState, ErrorBox, Skeleton } from '@/ui/kit';
import { Tri } from '@/ui/Shapes';
import { usePublicEvents } from './api';
import { EventTicket, availability } from './EventTicket';
import { activityText, keepName, kindLabel, lectureText, timeRange } from './eventText';
import { trackingQuery } from './tracking';
import { Hero, Slogan } from './Hero';
import { DetailsLink } from './MeetingDetails';
import { H2, OtherPerson } from './friday/sections';
import { ownToken } from './device';
import { bookable, ctaLabel, fridayPlan } from './friday/model';
import { HILLS } from './photos';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'short' });

/** The ticket's button: the same label as on #/friday and #/e (ctaLabel), or "לפרטים" when no one can register. */
function cta(e: PublicEvent): string {
  return bookable(e) ? ctaLabel(e) : 'לפרטים';
}

/**
 * What the home page features: the next Friday meeting (the hero speaks about Friday mornings), then the later Fridays
 * and, under their own heading, the meetings of other kinds. With no Friday meeting open, the earliest meeting of any
 * kind is featured, its kind said on the ticket.
 */
function homePlan(events: PublicEvent[]) {
  const friday = fridayPlan(events).next;
  const next = friday ?? events[0] ?? null;
  const rest = events.filter((e) => e !== next);
  return { next, fridays: rest.filter((e) => e.type === 'friday'), others: rest.filter((e) => e.type !== 'friday') };
}

export function PublicHome() {
  const [params] = useSearchParams();
  const query = trackingQuery(params);
  const events = usePublicEvents();
  const { next, fridays, others } = homePlan(events.data ?? []);
  const more = fridays.length + others.length > 0;
  const nextKind = next && next.type !== 'friday' ? kindLabel(next) : null;
  // this phone registered for the featured meeting (one registration saved here): the button leads to its own page
  const mine = next ? ownToken(next.code) : null;

  return (
    <div>
      <Hero
        photo={HILLS}
        position="50% 62%"
        titleSize="slogan"
        title={<Slogan />}
      >
        <p>
          <span className="whitespace-nowrap">המשך תנועה</span> היא הבית ללוחמים וללוחמות אחרי&nbsp;השירות. בשישי&nbsp;בבוקר: אימון,
          קפה ונשנושים והרצאת&nbsp;אורח.
        </p>
        {/* a way to read more, quieter than the meeting's own button below: one filled call to action per screen */}
        <Link
          to={`/friday${query}`}
          className="-ms-1 mt-2 inline-flex min-h-11 items-center gap-2 px-1 font-semibold text-light underline decoration-light/50 underline-offset-4 hover:decoration-light sm:mt-3"
          data-testid="home-friday"
        >
          על מפגשי שישי
          <Tri className="text-light" />
        </Link>
      </Hero>

      <div className="mt-5 sm:mt-8 lg:mt-10">
        {events.isPending ? (
          <Skeleton lines={6} />
        ) : events.isError && !events.data ? (
          <ErrorBox error={errorMessage(events.error)} onRetry={() => events.refetch()} />
        ) : !next ? (
          <div className="rounded-[var(--radius-panel)] border border-edge bg-paper">
            <EmptyState icon="calendar" title="אין כרגע מפגשים פתוחים להרשמה">
              כל מפגש מתפרסם כאן, באינסטגרם ובקבוצות הוואטסאפ של&nbsp;העמותה.
            </EmptyState>
          </div>
        ) : (
          <div className={more ? 'grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-10' : 'lg:max-w-xl'}>
            <section aria-labelledby="next-meeting" className="lg:sticky lg:top-6">
              <h2 id="next-meeting" className={`${H2} mb-3 lg:mb-4`}>המפגש הקרוב</h2>
              <EventTicket event={next} highlight level={3} showStatus="notable" kind={nextKind} className="relative">
                <ButtonLink
                  to={mine ? `/m/${mine}` : `/r/${next.code}${query}`}
                  cta
                  size="lg"
                  className="mt-4 w-full after:absolute after:inset-0 after:content-[''] sm:w-auto sm:min-w-[13.5rem]"
                  data-testid="home-cta"
                >
                  {mine ? 'לעמוד ההרשמה שלי' : cta(next)}
                  <span className="sr-only">: {next.title}, {fmtDayLong(next.starts_at)}</span>
                </ButtonLink>
                {/* above the button's whole-card link (its ::after overlay), like the details link */}
                {mine && <OtherPerson event={next} query={query} className="relative z-[1]" />}
                {!mine && bookable(next) && !next.is_full && <p className="mt-2 text-body-sm text-muted">ההרשמה לוקחת פחות מדקה.</p>}
                {/* above the button's whole-card link (its ::after overlay) */}
                <DetailsLink event={next} query={query} className="relative z-[1] mt-3" />
              </EventTicket>
            </section>
            {more && (
              <div className="flex flex-col gap-8">
                {fridays.length > 0 && (
                  <section aria-labelledby="more-fridays">
                    <h2 id="more-fridays" className={`${H2} mb-3 lg:mb-4`}>{next.type === 'friday' ? 'עוד מפגשי שישי' : 'מפגשי שישי'}</h2>
                    <ul className="divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper">
                      {fridays.map((e) => <ScheduleRow key={e.code} event={e} to={`/r/${e.code}${query}`} />)}
                    </ul>
                  </section>
                )}
                {others.length > 0 && (
                  <section aria-labelledby="more-meetings">
                    <h2 id="more-meetings" className={`${H2} mb-3 lg:mb-4`}>מפגשים אחרים</h2>
                    <ul className="divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper">
                      {others.map((e) => <ScheduleRow key={e.code} event={e} to={`/r/${e.code}${query}`} kind />)}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One meeting in the schedule (book p.63: date, what, the triangle). The whole row is the link; its name is the title
 * and the date, so a screen reader tells the rows apart even when the titles repeat (and the heading list stays clean).
 */
function ScheduleRow({ event: e, to, kind = false }: { event: PublicEvent; to: string; kind?: boolean }) {
  const start = new Date(e.starts_at);
  const status = availability(e);
  const what = lectureText(e) ?? activityText(e);
  const label = kind ? kindLabel(e) : null;
  return (
    <li className="relative flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-mist/70 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:-outline-offset-3 has-[a:focus-visible]:outline-ink">
      <div className="min-w-0 flex-1">
        {label && <p className="text-small font-semibold text-ink-soft">{label}</p>}
        <h3 className="font-semibold leading-snug">
          <Link to={to} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {keepName(e.title)}
            <span className="sr-only">, {fmtDayLong(start)}</span>
          </Link>
        </h3>
        <p className="mt-0.5 text-small text-muted">
          <span className="num">{timeRange(e)}</span> · {relativeDays(start)}
        </p>
        {e.location && <p className="text-small text-muted">{e.location}</p>}
        {what && <p className="mt-0.5 line-clamp-2 text-small text-ink-soft">{keepName(what)}</p>}
        {!status.plain && <div className="mt-1.5"><Badge tone={status.tone}>{status.text}</Badge></div>}
      </div>
      <div className="order-first flex w-14 shrink-0 flex-col items-center text-center" aria-hidden="true">
        <span className="text-micro font-medium text-ink-soft">{fmtDay(start)}</span>
        <span className="num font-display text-title-sm leading-none">{dayNum.format(start)}</span>
        <span className="text-micro font-medium text-ink-soft">{monthShort.format(start)}</span>
      </div>
      <Tri className="shrink-0 text-ink" size="0.8em" />
    </li>
  );
}
