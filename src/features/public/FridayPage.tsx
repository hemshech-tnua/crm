import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { appBase } from '@/lib/links';
import { fmtMoney } from '@/lib/money';
import { ButtonLink, ErrorBox, Skeleton } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { usePublicEvents } from './api';
import { ownToken } from './device';
import { trackingQuery } from './tracking';
import { Hero, Slogan } from './Hero';
import { CtaBar } from './MeetingDetails';
import { paysFirst } from './PayStep';
import { HILLS } from './photos';
import { usePageTitle } from './shared';
import { ctaLabel, fridayPlan } from './friday/model';
import { AskUs, ClosingBand, Faq, FlyerSection, ForWhom, H2, LowThreshold, MainButton, MoreMeetings, NextTicket, NoMeeting, Program } from './friday/sections';

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
 * The phone's bottom bar on #/friday, the same bar as on #/e: only while the visitor has scrolled past the ticket's
 * button and has not reached the closing band's (so there is never a second "להרשמה" in view, and it never covers the
 * footer). Unmounted while hidden; no animation. The fee is said here only when the button leads to paying, because
 * the ticket that says it is out of view. A phone that already registered goes to its own page instead.
 * Visibility is computed from where the two elements are, at mount and on every change: an observer alone misses a
 * jump (an anchor, a restored scroll, a flick at 320px) that takes the button from below the screen to above it
 * without ever crossing it.
 */
function StickyCta({ event: e, query }: { event: PublicEvent; query: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const cta = document.querySelector('[data-testid="friday-cta"]');
      const band = document.getElementById('friday-close');
      if (!cta || !band) return setShow(false);
      setShow(cta.getBoundingClientRect().bottom < 0 && band.getBoundingClientRect().top > window.innerHeight);
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    const cta = document.querySelector('[data-testid="friday-cta"]');
    const band = document.getElementById('friday-close');
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(update);
    if (io && cta) io.observe(cta);
    if (io && band) io.observe(band);
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      io?.disconnect();
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [e.code]);
  if (!show) return null;
  const token = ownToken(e.code);
  return (
    <CtaBar testId="friday-sticky-cta">
      {token ? (
        <ButtonLink to={`/m/${token}`} size="lg" cta className="w-full">לעמוד ההרשמה שלי</ButtonLink>
      ) : (
        <ButtonLink to={`/r/${e.code}${query}`} size="lg" cta className="w-full">
          {ctaLabel(e)}
          {paysFirst(e) && !e.is_full && <> · <span className="num">{fmtMoney(e.price)}</span></>}
          <span className="sr-only">: {e.title}, {fmtDayLong(e.starts_at)}</span>
        </ButtonLink>
      )}
    </CtaBar>
  );
}

/**
 * The line under the poster's button, true for the meeting it leads to: a pay-first meeting is paid at the end of the
 * form, a full one has a waiting list, and only a free registration "takes less than a minute".
 */
function heroNote(e: PublicEvent): string {
  if (e.is_full) return 'אם יתפנה מקום, נעדכן אתכם לפי סדר ההרשמה.';
  if (paysFirst(e)) return 'משלמים בסוף ההרשמה, בדף התשלום המאובטח.';
  return 'ההרשמה לוקחת פחות מדקה. אפשר לבטל בקישור\u00a0האישי.';
}

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
  // later Fridays and the other kinds of meeting, in date order
  const more = [...plan.later, ...plan.others].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  usePageTitle('מפגשי שישי');
  // this phone registered for the next meeting: its buttons lead to the registration's own page
  const mine = plan.next ? ownToken(plan.next.code) : null;

  return (
    <div>
      <Hero photo={HILLS} position="50% 74%" kicker={KICKER} title={<Slogan />}>
        <p>אימון, קפה והרצאה, עם אנשים שהיו&nbsp;שם. באים לבד או עם&nbsp;חברים.</p>
        {plan.next && (
          <p className="mt-4 hidden font-display text-section text-light sm:block">
            {fmtDayLong(plan.next.starts_at)} · <span className="num">{fmtTime(plan.next.starts_at)}</span>
          </p>
        )}
        {/* on a wide screen the ticket's button falls under the fold, so the poster carries one too */}
        {plan.next && (
          <div className="mt-6 hidden lg:block">
            <MainButton event={plan.next} query={query} token={mine} variant="light" />
            {!mine && <p className="mt-2.5 text-small text-light/85">{heroNote(plan.next)}</p>}
          </div>
        )}
      </Hero>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-10 sm:mt-8 lg:mt-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <section aria-labelledby="friday-next" aria-busy={events.isPending || undefined}>
          <h2 id="friday-next" className={`${H2} mb-3 lg:mb-4`}>המפגש הקרוב</h2>
          {events.isPending ? (
            <Skeleton lines={6} />
          ) : events.isError && !events.data ? (
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
          {more.length > 0 && <MoreMeetings events={more} query={query} />}
          <AskUs />
        </div>
      </div>

      <div className="mt-12 lg:mt-20">
        <ClosingBand next={plan.next} query={query} url={pageUrl} message={SHARE_MESSAGE} onCopy={copyLink} />
      </div>

      {plan.next && <StickyCta event={plan.next} query={query} />}
    </div>
  );
}
