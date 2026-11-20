import { useSearchParams } from 'react-router';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { appBase } from '@/lib/links';
import { ButtonLink, ErrorBox, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import hills from '@/assets/photos/hills.webp';
import { usePublicEvents } from './api';
import { trackingQuery } from './tracking';
import { Hero, Slogan } from './Hero';
import { usePageTitle } from './shared';
import { ctaLabel, fridayPlan } from './friday/model';
import { FRIDAY_FACTS } from './friday/facts';
import { AskUs, ClosingBand, Faq, FlyerSection, ForWhom, Greeter, H2, LowThreshold, MoreMeetings, NextTicket, NoMeeting, Program } from './friday/sections';

/*
  The flyer slot. When the coordinator's flyer arrives, put the file in src/assets/flyers/ and import it here:

    import flyer from '@/assets/flyers/friday.webp';
    const FLYER: string | null = flyer;

  and describe what the flyer says in FLYER_ALT (screen readers read it instead of the image).
  While FLYER is null the "הפלייר" section is not rendered at all.
*/
const FLYER: string | null = null;
const FLYER_ALT = 'הפלייר של מפגשי שישי של המשך תנועה: אימון, קפה ונשנושים והרצאת אורח, ללוחמים וללוחמות אחרי השירות';

/** The WhatsApp text of the closing band (the page link follows on its own line). */
const SHARE_MESSAGE = 'חשבתי עליך. יש בשישי בבוקר מפגש של לוחמים ולוחמות אחרי השירות: אימון, קפה ונשנושים והרצאה. נראה לי שזה בשבילך.';

/** The kicker over the slogan: the dot sits with the first part, and each part stays whole when the line wraps. */
const KICKER = (
  <span className="block text-body sm:text-heading">
    <span className="whitespace-nowrap">מפגשי שישי ·</span>{' '}
    <span className="whitespace-nowrap">ללוחמים וללוחמות</span> <span className="whitespace-nowrap">אחרי השירות</span>
  </span>
);

/**
 * #/friday — the landing page for the Friday meetings, the one link shared on Instagram and WhatsApp.
 * Phone: the poster hero, then the next meeting with its "להרשמה" on the first screen. Wide screen: two columns
 * where it helps (the ticket beside the program, more meetings beside the questions).
 * The ?ref= / utm_* of the visit travel into the registration links; the shared link is the plain page link.
 */
export function FridayPage() {
  const [params] = useSearchParams();
  const query = trackingQuery(params);
  const events = usePublicEvents();
  const plan = fridayPlan(events.data);
  const copy = useCopy();
  const pageUrl = `${appBase()}#/friday`;
  const copyLink = () => void copy(pageUrl, 'הקישור לדף הועתק');
  const about = plan.next ?? plan.known;
  usePageTitle('מפגשי שישי');

  return (
    <div>
      <Hero photo={hills} position="50% 74%" kicker={KICKER} title={<Slogan />}>
        <p>אימון, קפה והרצאה, עם אנשים שהיו&nbsp;שם. באים לבד או עם&nbsp;חברים.</p>
        {plan.next && (
          <p className="mt-4 hidden font-display text-section text-light sm:block">
            {fmtDayLong(plan.next.starts_at)} · <span className="num">{fmtTime(plan.next.starts_at)}</span>
          </p>
        )}
        {/* on a wide screen the ticket's button falls under the fold, so the poster carries one too */}
        {plan.next && (
          <div className="mt-6 hidden lg:block">
            <ButtonLink to={`/r/${plan.next.code}${query}`} variant="light" size="lg" cta>
              {ctaLabel(plan.next)}
              <span className="sr-only">: {plan.next.title}, {fmtDayLong(plan.next.starts_at)}</span>
            </ButtonLink>
            <p className="mt-2.5 text-small text-light/85">ההרשמה לוקחת פחות מדקה. אפשר לבטל בקישור&nbsp;האישי.</p>
          </div>
        )}
      </Hero>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-10 sm:mt-8 lg:mt-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <section aria-labelledby="friday-next" aria-busy={events.isPending || undefined}>
          <h2 id="friday-next" className={`${H2} mb-3 lg:mb-4`}>המפגש הקרוב</h2>
          {events.isPending ? (
            <Skeleton lines={6} />
          ) : events.isError ? (
            <ErrorBox error={errorMessage(events.error)} onRetry={() => events.refetch()} />
          ) : plan.next ? (
            <NextTicket event={plan.next} query={query} />
          ) : (
            <NoMeeting known={plan.known} />
          )}
        </section>
        <Program event={about} className="lg:mt-[3.25rem]" />
      </div>

      <div className="mt-12 lg:mt-20">
        <ForWhom />
      </div>

      {/* right after "אתם לא מכירים שם אף אחד": who meets you at the entrance */}
      {FRIDAY_FACTS.greeter && (
        <div className="mt-10 lg:mt-14">
          <Greeter />
        </div>
      )}

      <div className="mt-12 lg:mt-16">
        <LowThreshold />
      </div>

      {FLYER && (
        <div className="mt-12 lg:mt-16">
          <FlyerSection src={FLYER} alt={FLYER_ALT} onShare={copyLink} />
        </div>
      )}

      {/* two columns on a wide screen: the questions, and beside them the later meetings and a way to ask */}
      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:mt-20 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <Faq event={about} />
        <div className="flex flex-col gap-12 lg:sticky lg:top-6 lg:gap-10">
          {plan.later.length > 0 && <MoreMeetings events={plan.later} query={query} />}
          <AskUs />
        </div>
      </div>

      <div className="mt-12 lg:mt-20">
        <ClosingBand next={plan.next} query={query} url={pageUrl} message={SHARE_MESSAGE} onCopy={copyLink} />
      </div>
    </div>
  );
}
