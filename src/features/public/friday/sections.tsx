// The sections of the Friday landing page (#/friday). Brand book: navy and beige only, 45° stripes from a corner,
// the triangle ◀ as bullet and call to action, squared corners, plural and warm copy.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, fmtDayLong, fmtTime } from '@/lib/dates';
import { Badge, Button, ButtonLink, ExternalButton, cx } from '@/ui/kit';
import { Stripes, Tri } from '@/ui/Shapes';
import { EventTicket, availability } from '../EventTicket';
import { ContactLine, transitUrl, wazeUrl } from '../shared';
import { activityText, keepName, lectureText, timeRange } from '../eventText';
import { fmtMoney, isPriced } from '@/lib/money';
import { ctaLabel, lowThreshold, paymentNoteOf, priceOf, program } from './model';
import { FRIDAY_FACTS } from './facts';
import { CTA_WIDTH, DetailsLink } from '../MeetingDetails';

/** Section headings: the book's Bold, one step under the hero. */
export const H2 = 'font-display text-section lg:text-[1.625rem] lg:leading-tight';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'short' });

// ───────────── the next meeting ─────────────

const endSentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/**
 * The ticket of the next Friday meeting with the big call to action: when, where, coffee, and the fee when there is one
 * (the payment note goes under the button). The activity and the lecture are in the program beside it, not repeated
 * here, so on a phone the button stays on the first screen. Who meets first-timers has its own section (Greeter).
 */
export function NextTicket({ event: e, query }: { event: PublicEvent; query: string }) {
  const price = priceOf(e);
  const note = paymentNoteOf(e);
  return (
    <EventTicket event={e} highlight level={3} showStatus="notable" agenda={false}>
      <ButtonLink to={`/r/${e.code}${query}`} size="lg" cta className={`mt-4 w-full ${CTA_WIDTH}`} data-testid="friday-cta">
        {ctaLabel(e)}
        <span className="sr-only">: {e.title}, {fmtDayLong(e.starts_at)}</span>
      </ButtonLink>
      <p className="mt-2 text-small text-muted">
        {e.is_full ? 'אם יתפנה מקום, נעדכן אתכם לפי סדר ההרשמה.' : 'ההרשמה לוקחת פחות מדקה.'}
        {isPriced(price) && note && <> {endSentence(note)}</>}
      </p>
      <DetailsLink event={e} query={query} wide="phone" className="mt-3" />
    </EventTicket>
  );
}

/** No Friday meeting open for registration: calm, with the date when one is known, and a way to reach the team. */
export function NoMeeting({ known }: { known: PublicEvent | null }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper px-5 py-6 sm:px-6" data-testid="friday-empty">
      {known ? (
        <>
          <p className="text-small font-semibold text-muted">המפגש הבא</p>
          <p className="mt-0.5 font-display text-section">{fmtDayLong(known.starts_at)}</p>
          <p className="mt-1 text-ink-soft">
            <span className="num">{timeRange(known)}</span>
            {known.location && <> · {known.location}</>}
          </p>
          <p className="mt-3 max-w-md text-ink-soft">
            {known.registration_open && known.is_full
              ? 'המפגש הזה כבר מלא. המפגש שאחריו יפורסם כאן בקרוב.'
              : 'ההרשמה למפגש הזה עוד לא נפתחה. היא תיפתח כאן בקרוב.'}
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-section">המפגש הבא יפורסם בקרוב</p>
          <p className="mt-1.5 max-w-md text-ink-soft">כל מפגש מתפרסם כאן, באינסטגרם ובקבוצות הוואטסאפ של&nbsp;העמותה.</p>
        </>
      )}
      <div className="mt-2">
        <ContactLine />
      </div>
    </div>
  );
}

// ───────────── what happens on Friday ─────────────

/** The morning, in the program style of the book (p.63): navy ground, time, the triangle, what and with whom. */
export function Program({ event, className }: { event: PublicEvent | null; className?: string }) {
  const items = program(event);
  return (
    <section aria-labelledby="friday-program" className={cx(className, 'relative -mx-5 overflow-hidden bg-ink text-light sm:mx-0 sm:rounded-[var(--radius-panel)]')}>
      {/* stripes enter from the top-left corner, cut by the panel's top and left edges, clear of the heading */}
      <Stripes width={180} height={56} unit={16} dir="fall" count={3} offset={0} className="absolute top-0 left-0 h-14 w-[180px] text-light" />
      <div className="relative px-5 pt-6 pb-4 sm:px-7 sm:pt-7 sm:pb-5">
        <h2 id="friday-program" className={H2}>ככה נראה הבוקר</h2>
        <ol className="mt-5">
          {items.map((it) => (
            <li key={it.title} className="grid grid-cols-[4.5rem_auto_minmax(0,1fr)] items-baseline gap-x-3 border-t border-light/20 py-3.5 sm:grid-cols-[5rem_auto_minmax(0,1fr)] sm:gap-x-4">
              <span className="text-small font-semibold text-light/90">
                {it.time && (
                  <>
                    {it.until && 'עד '}
                    <span className="num">{it.time}</span>
                  </>
                )}
              </span>
              <Tri className="text-light" size="0.75em" />
              <span className="min-w-0">
                <span className="block text-heading font-bold">{it.title}</span>
                {it.detail && <span className="mt-0.5 block text-small text-light/85">{keepName(it.detail)}</span>}
                {it.note && <span className="mt-1 block text-small font-semibold text-light" data-fact="allLevels">{it.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ───────────── who it is for ─────────────

const FOR_WHOM = [
  'שירתם כלוחמים או כלוחמות, לא משנה לפני כמה\u00a0זמן',
  'חסרה לכם לפעמים התחושה של\u00a0צוות',
  'בא לכם להתחיל את השישי בתנועה ולא\u00a0בגלילה',
  'אתם לא מכירים שם אף אחד. גם זה\u00a0בסדר.',
];

/** "זה בשבילכם אם…": the visitor recognises themselves, the last line answers the fear of arriving alone. */
export function ForWhom() {
  return (
    <section aria-labelledby="friday-who" className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:gap-10">
      <h2 id="friday-who" className={cx(H2, 'lg:self-start lg:pt-4')}>זה בשבילכם אם…</h2>
      <ul className="mt-4 grid gap-x-10 lg:mt-0 lg:grid-cols-2">
        {FOR_WHOM.map((line) => (
          <li key={line} className="flex items-baseline gap-3 border-t border-ink py-3.5 text-heading font-semibold text-pretty text-ink lg:py-4 lg:text-section">
            <Tri className="text-ink" size="0.62em" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────── the low threshold ─────────────

/** One navy band of short "no strings" points, the triangle before each. No heading on screen: it is a list of facts. */
export function LowThreshold() {
  return (
    <section aria-label="בלי אותיות קטנות" className="relative -mx-5 overflow-hidden bg-ink text-light sm:mx-0 sm:rounded-[var(--radius-panel)]">
      <Stripes width={150} height={44} unit={14} dir="fall" count={3} offset={0} className="absolute top-0 left-0 h-11 w-[150px] text-light" />
      <ul className="relative flex flex-col gap-3 px-5 pt-14 pb-6 sm:flex-row sm:flex-wrap sm:gap-x-9 sm:gap-y-3 sm:py-7 sm:ps-7 sm:pe-44 lg:py-8 lg:ps-10 lg:pe-48">
        {lowThreshold().map((item) => (
          <li key={item} className="flex items-baseline gap-2.5 font-display text-section whitespace-nowrap lg:text-[1.5rem]">
            <Tri className="text-light" size="0.6em" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────── who meets you ─────────────

/**
 * Only once the team names the person at the entrance (FRIDAY_FACTS.greeter). Right after "זה בשבילכם אם…", whose last
 * line is the fear of arriving alone; the page says it here once (and in the matching question).
 */
export function Greeter() {
  if (!FRIDAY_FACTS.greeter) return null;
  return (
    <section aria-labelledby="friday-greeter" data-fact="greeter">
      <h2 id="friday-greeter" className={H2}>מי מקבל אתכם</h2>
      <p className="mt-3 max-w-2xl text-heading text-ink lg:text-section">
        {FRIDAY_FACTS.greeter} מהצוות מחכה לכם בכניסה ומכיר לכם כמה&nbsp;אנשים.
      </p>
    </section>
  );
}

// ───────────── the flyer ─────────────

/** The coordinator's flyer, with sharing (the link to this page) and a download for stories. Renders nothing without one. */
export function FlyerSection({ src, alt, onShare }: { src: string | null; alt: string; onShare: () => void }) {
  if (!src) return null;
  return (
    <section aria-labelledby="friday-flyer" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
      <div>
        <h2 id="friday-flyer" className={H2}>הפלייר</h2>
        <p className="mt-2 max-w-md text-ink-soft">
          מעלים לסטורי או שולחים בקבוצה. מי שמגיע דרך הקישור לדף הזה נרשם בדקה.
        </p>
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
          <Button icon="link" onClick={onShare}>העתקת הקישור</Button>
          <a href={src} download className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-control-line px-4 text-body-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-ink/[0.06]">
            הורדת הפלייר
          </a>
        </div>
      </div>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="order-first w-full max-w-md justify-self-center rounded-[var(--radius-panel)] border border-edge bg-paper lg:order-none lg:justify-self-end"
      />
    </section>
  );
}

// ───────────── more meetings ─────────────

/** The Friday meetings after the next one, as compact rows (date, time, what). The whole row is the link. */
export function MoreMeetings({ events, query }: { events: PublicEvent[]; query: string }) {
  return (
    <section aria-labelledby="friday-more">
      <h2 id="friday-more" className={H2}>עוד מפגשים</h2>
      <ul className="mt-3 divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper lg:mt-4">
        {events.map((e) => <MeetingRow key={e.code} event={e} to={`/r/${e.code}${query}`} />)}
      </ul>
    </section>
  );
}

function MeetingRow({ event: e, to }: { event: PublicEvent; to: string }) {
  const start = new Date(e.starts_at);
  const status = availability(e);
  const what = lectureText(e) ?? activityText(e);
  return (
    <li className="relative flex min-h-[4.5rem] items-center gap-4 px-4 py-3 transition-colors hover:bg-mist/70 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:-outline-offset-3 has-[a:focus-visible]:outline-ink">
      <div className="flex w-12 shrink-0 flex-col items-center text-center" aria-hidden="true">
        <span className="text-micro font-medium text-ink-soft">{fmtDay(start)}</span>
        <span className="num font-display text-[1.625rem] leading-none">{dayNum.format(start)}</span>
        <span className="text-micro font-medium text-ink-soft">{monthShort.format(start)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">
          <Link to={to} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {fmtDayLong(start)}
            <span className="sr-only">. {e.title}. {ctaLabel(e)}</span>
          </Link>
        </h3>
        <p className="mt-0.5 line-clamp-2 text-small text-muted">
          <span className="num">{fmtTime(start)}</span>
          {what ? <> · {what}</> : e.location ? <> · {e.location}</> : null}
        </p>
        {!status.plain && <div className="mt-1.5"><Badge tone={status.tone}>{status.text}</Badge></div>}
      </div>
      <Tri className="shrink-0 text-ink" size="0.8em" />
    </li>
  );
}

// ───────────── questions ─────────────

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-heading font-semibold transition-colors select-none hover:bg-mist/60 focus-visible:-outline-offset-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Tri className="text-ink transition-transform duration-200 group-open:-rotate-90" size="0.7em" />
        <span className="min-w-0">{q}</span>
      </summary>
      <div className="px-4 pb-4 ps-[2.15rem] text-ink-soft sm:px-5 sm:ps-[2.4rem]">{children}</div>
    </details>
  );
}

/** A heading inside the questions panel that groups the questions under it (a sub-level of the section's h2). */
function QuestionGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="divide-y divide-edge">
      <h3 id={id} className="bg-mist/60 px-4 py-2.5 text-small font-semibold tracking-wide text-ink-soft sm:px-5">{title}</h3>
      {children}
    </div>
  );
}

const linkClass = 'inline-flex min-h-11 items-center gap-1.5 font-semibold text-tide underline underline-offset-2';

/**
 * Questions and answers for someone deciding whether to come, grouped by what they need to know: the meeting itself,
 * getting there and preparing, then registration, payment and privacy. Every answer states only what is true today
 * (from the meeting's data, the privacy policy or the form); questions that depend on a fact the team has not
 * confirmed (FRIDAY_FACTS) appear only once it is set.
 */
export function Faq({ event }: { event: PublicEvent | null }) {
  const price = priceOf(event);
  const note = paymentNoteOf(event);
  const place = event?.location ?? null;
  const f = FRIDAY_FACTS;
  return (
    <section aria-labelledby="friday-faq">
      <h2 id="friday-faq" className={H2}>שאלות ותשובות</h2>
      <div className="mt-3 divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper lg:mt-4">
        <QuestionGroup id="faq-about" title="על המפגש">
          <Question q="למי מיועדים המפגשים?">
            ללוחמים וללוחמות אחרי השירות, לא משנה כמה זמן עבר מהשחרור. לא צריך להכיר מראש את העמותה או את&nbsp;המשתתפים.
          </Question>
          <Question q={'אפשר להגיע לבד, בלי להכיר אף\u00a0אחד?'}>
            <p>כן. אחרי האימון יושבים יחד לקפה ולנשנושים, ורק אז מתחילה ההרצאה. יש זמן&nbsp;להכיר.</p>
            {f.greeter && <p className="mt-1.5">{f.greeter} מהצוות מחכה בכניסה ומכיר למי שבא בפעם הראשונה כמה&nbsp;אנשים.</p>}
          </Question>
          <Question q="צריך לשתף משהו אישי או לדבר על השירות?">
            לא. זה לא מעגל שיחה: מתאמנים, יושבים לקפה ושומעים הרצאה. כל אחד ואחת משתפים רק את מה
            שהם&nbsp;רוצים.
          </Question>
          {f.allLevels && (
            <Question q="נדרשת רמת כושר מסוימת?">
              לא. האימון מתאים לכל רמות&nbsp;הכושר.
            </Question>
          )}
          <Question q="אפשר להביא חבר או חברה?">
            כן, בשמחה. כל אחד ואחת נרשמים בנפרד, אז שלחו להם את הקישור&nbsp;לדף.
          </Question>
        </QuestionGroup>

        <QuestionGroup id="faq-arrive" title="הגעה והכנה">
          {place && (
            <Question q="איפה מתקיים המפגש ואיך מגיעים?">
              <p>{place}</p>
              {f.parking && <p className="mt-1">{f.parking}</p>}
              <p className="mt-1 flex flex-wrap gap-x-5">
                <a href={wazeUrl(place)} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  ניווט ב-Waze<span className="sr-only"> (נפתח בחלון חדש)</span>
                </a>
                <a href={transitUrl(place)} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  תחבורה ציבורית<span className="sr-only"> (נפתח בחלון חדש)</span>
                </a>
              </p>
            </Question>
          )}
          <Question q="מה כדאי להביא?">
            בגדים ונעליים נוחים לאימון, ובקבוק מים. את הקפה והנשנושים אנחנו&nbsp;מביאים.
          </Question>
          {f.showers && <Question q="יש מקום להחליף בגדים או להתקלח?">{f.showers}</Question>}
          {f.partialOk && (
            <Question q="אפשר להגיע רק לחלק מהבוקר?">
              כן, אפשר להגיע רק לאימון או רק להרצאה. גם השתתפות בחלק מהבוקר היא&nbsp;בתשלום.
            </Question>
          )}
        </QuestionGroup>

        <QuestionGroup id="faq-register" title="הרשמה, תשלום ופרטיות">
          <Question q="כמה עולה ההשתתפות?">
            {isPriced(price) ? (
              // the price on its own line (a sentence ending in "₪" breaks badly), then how and when to pay
              <>
                <p>מחיר: <span className="num font-semibold text-ink">{fmtMoney(price)}</span></p>
                <p className="mt-1.5">
                  {event?.payment_url
                    // the team's payment note says how to pay; without one, the payment page takes a credit card
                    ? `משלמים בסוף ההרשמה${note ? '' : ', בכרטיס אשראי'}. ההרשמה מאושרת מיד אחרי התשלום.`
                    : 'משלמים בכניסה למפגש.'}
                  {note && <> {endSentence(note)}</>}
                </p>
              </>
            ) : price === 0 ? (
              'ההשתתפות בחינם.'
            ) : (
              // no price published: say so, and how to ask, rather than promise details the registration page does not show
              <>
                {event ? 'המחיר למפגש הזה עוד לא מופיע באתר.' : 'המחיר עוד לא מופיע באתר.'} אפשר לשאול אותנו: <ContactLine inline />
              </>
            )}
          </Question>
          <Question q="איך מבטלים או משנים הרשמה?">
            בקישור האישי שמקבלים בסוף ההרשמה. ביטול מראש מפנה את המקום למי&nbsp;שמחכה.
          </Question>
          <Question q="מה קורה עם הפרטים שממלאים בטופס?">
            הפרטים משמשים רק לניהול ההרשמה וההגעה ולחזרה אליכם. רק צוות העמותה רואה אותם. הם לא נמכרים ולא מועברים
            לגורמים אחרים.{' '}
            <Link to="/privacy" className="font-semibold text-tide underline underline-offset-2">למדיניות הפרטיות</Link>
          </Question>
          <Question q="מצלמים במפגשים?">
            לפעמים, בשביל העמודים של העמותה. לא רוצים שיפורסמו תמונות שלכם? מסמנים את זה בטופס ההרשמה, והצוות רואה את
            הבקשה.
          </Question>
        </QuestionGroup>
      </div>
    </section>
  );
}

/** Beside the questions on a wide screen when no later meetings fill that column: one more way to ask. */
export function AskUs() {
  return (
    <section aria-labelledby="friday-ask">
      <h2 id="friday-ask" className={H2}>שאלה אחרת?</h2>
      <p className="mt-3 rounded-[var(--radius-panel)] border border-edge bg-paper px-4 pt-3 pb-1 text-ink-soft sm:px-5 lg:mt-4">
        <ContactLine inline />
      </p>
    </section>
  );
}

// ───────────── closing ─────────────

/**
 * The closing band: navy, stripes from the corner. The question and the registration button for the next meeting, then a quieter
 * second action: send the page to someone from the old team (copy the link, or WhatsApp with a ready message).
 */
export function ClosingBand({ next, query, url, message, onCopy }: {
  next: PublicEvent | null; query: string; url: string; message: string; onCopy: () => void;
}) {
  return (
    <section aria-labelledby="friday-close" className="relative -mx-5 overflow-hidden bg-ink text-light sm:mx-0 sm:rounded-[var(--radius-panel)]">
      {/* the same stripe weight as the program panel: a short run from the top-left corner, cut by the band's edges */}
      <Stripes width={220} height={64} unit={18} dir="fall" count={3} offset={0} className="absolute top-0 left-0 h-16 w-[220px] text-light" />
      <div className="relative px-5 pt-20 pb-7 sm:px-7 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-14 lg:px-10 lg:pt-24 lg:pb-10">
        <div>
          <h2 id="friday-close" className="font-display text-[2rem] leading-tight lg:text-[2.75rem]">נתראה בשישי?</h2>
          {next && (
            <ButtonLink to={`/r/${next.code}${query}`} variant="light" size="lg" cta className="mt-5 w-full sm:w-auto" data-testid="friday-closing-cta">
              {ctaLabel(next)}
              <span className="sr-only">: {next.title}, {fmtDayLong(next.starts_at)}</span>
            </ButtonLink>
          )}
        </div>
        <div className="mt-8 border-t border-light/25 pt-5 lg:mt-0 lg:border-t-0 lg:border-s lg:ps-10 lg:pt-0">
          <p className="max-w-sm text-light/90">
            יש מישהו מהצוות הישן שחסר&nbsp;לכם?
            <span className="block">שלחו לו את&nbsp;הקישור.</span>
          </p>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <Button variant="onDark" icon="copy" onClick={onCopy}>העתקת הקישור</Button>
            <ExternalButton href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`} variant="onDark" icon="message">
              שליחה בוואטסאפ
            </ExternalButton>
          </div>
        </div>
      </div>
    </section>
  );
}
