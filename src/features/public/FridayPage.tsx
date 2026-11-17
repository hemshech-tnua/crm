import { useSearchParams } from 'react-router';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { appBase } from '@/lib/links';
import { ButtonLink, ErrorBox, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import hills from '@/assets/photos/hills.webp';
import { usePublicEvents } from './api';
import { trackingQuery } from './tracking';
import { Hero } from './Hero';
import { ctaLabel, fridayPlan } from './friday/model';
import { Faq, FlyerSection, ForWhom, H2, MoreMeetings, NextTicket, NoMeeting, Program, ShareBand } from './friday/sections';

/*
  The flyer slot. When the coordinator's flyer arrives, put the file in src/assets/flyers/ and import it here:

    import flyer from '@/assets/flyers/friday.webp';
    const FLYER: string | null = flyer;

  and describe what the flyer says in FLYER_ALT (screen readers read it instead of the image).
  While FLYER is null the "הפלייר" section is not rendered at all.
*/
const FLYER: string | null = null;
const FLYER_ALT = 'הפלייר של מפגשי שישי של המשך תנועה: אימון, הרצאת אורח וארוחת בוקר ביחד, ללוחמים וללוחמות אחרי השירות';

const SHARE_MESSAGE = 'מפגשי שישי של המשך תנועה: אימון, הרצאת אורח וארוחת בוקר ביחד, ללוחמים וללוחמות אחרי השירות. בואו איתנו:';

/**
 * #/friday — the landing page for the Friday meetings, the one link shared on Instagram and WhatsApp.
 * Phone: the poster hero, then the next meeting with its "שמרו לי מקום" on the first screen. Wide screen: two columns
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

  return (
    <div>
      <Hero photo={hills} position="50% 74%" kicker="מפגשי שישי" title="בואו להמשיך תנועה">
        <p>בוקר של אימון, הרצאת אורח וארוחת בוקר ביחד, ללוחמים וללוחמות אחרי השירות.</p>
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

      <div className="mt-12 lg:mt-16">
        <ForWhom />
      </div>

      {FLYER && (
        <div className="mt-12 lg:mt-16">
          <FlyerSection src={FLYER} alt={FLYER_ALT} onShare={copyLink} />
        </div>
      )}

      <div className={plan.later.length ? 'mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:mt-16 lg:grid-cols-2 lg:gap-10' : 'mt-12 lg:mt-16 lg:max-w-2xl'}>
        {plan.later.length > 0 && <MoreMeetings events={plan.later} query={query} />}
        <Faq event={about} />
      </div>

      <div className="mt-12 lg:mt-16">
        <ShareBand url={pageUrl} message={SHARE_MESSAGE} onCopy={copyLink} />
      </div>
    </div>
  );
}
