// The sections of the Friday landing page (#/friday). Brand book: navy and beige only, 45° stripes from a corner,
// the triangle ◀ as bullet and call to action, squared corners, plural and warm copy.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PublicEvent } from '@/lib/types';
import { TZ, fmtDay, fmtDayLong, fmtTime } from '@/lib/dates';
import { Badge, Button, ButtonLink, ExternalButton, cx } from '@/ui/kit';
import { Stripes, Tri } from '@/ui/Shapes';
import { EventTicket, availability } from '../EventTicket';
import { ContactLine } from '../shared';
import { activityText, lectureText, timeRange } from '../eventText';
import { fmtMoney, isPriced } from '@/lib/money';
import { ctaLabel, paymentNoteOf, priceOf, program } from './model';

/** Section headings: the book's Bold, one step under the hero. */
export const H2 = 'font-display text-section lg:text-[1.625rem] lg:leading-tight';

const dayNum = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'short' });

// ───────────── the next meeting ─────────────

const endSentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/**
 * The ticket of the next Friday meeting with the big "שמרו לי מקום". The ticket itself shows the fee when there is one;
 * the payment note goes under the button.
 */
export function NextTicket({ event: e, query }: { event: PublicEvent; query: string }) {
  const price = priceOf(e);
  const note = paymentNoteOf(e);
  return (
    <EventTicket event={e} highlight level={3} showStatus="notable">
      <ButtonLink to={`/r/${e.code}${query}`} size="lg" cta className="mt-4 w-full sm:w-auto" data-testid="friday-cta">
        {ctaLabel(e)}
        <span className="sr-only">: {e.title}, {fmtDayLong(e.starts_at)}</span>
      </ButtonLink>
      <p className="mt-2 text-small text-muted">
        {e.is_full ? 'נפתח מקום? נעדכן אתכם לפי הסדר.' : 'ההרשמה לוקחת פחות מדקה.'}
        {isPriced(price) && note && <> {endSentence(note)}</>}
      </p>
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
              ? 'המקומות למפגש הזה כבר התמלאו. המפגש שאחריו יפורסם כאן בקרוב.'
              : 'ההרשמה למפגש הזה עוד לא נפתחה. היא תיפתח כאן בקרוב.'}
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-section">המפגש הבא יפורסם בקרוב</p>
          <p className="mt-1.5 max-w-md text-ink-soft">כל מפגש מתפרסם כאן, באינסטגרם ובקבוצות הוואטסאפ של העמותה.</p>
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
        <h2 id="friday-program" className={H2}>מה קורה בשישי</h2>
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
                <span className="block text-[1.0625rem] font-bold leading-snug">{it.title}</span>
                {it.detail && <span className="mt-0.5 block text-small text-light/85">{it.detail}</span>}
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
  'ללוחמים וללוחמות אחרי השירות, בכל שלב',
  'לא צריך להכיר אף אחד, באים כמו שאתם',
  'בלי התחייבות: נרשמים למפגש אחד ורואים',
];

export function ForWhom() {
  return (
    <section aria-labelledby="friday-who">
      <h2 id="friday-who" className={H2}>למי זה</h2>
      <ul className="mt-4 grid gap-x-8 gap-y-0 lg:mt-5 lg:grid-cols-3">
        {FOR_WHOM.map((line) => (
          <li key={line} className="flex items-baseline gap-3 border-t-2 border-ink py-3.5 text-[1.1875rem] leading-snug font-semibold text-ink lg:pt-4 lg:text-[1.3125rem]">
            <Tri className="text-ink" size="0.62em" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
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
          <Button icon="link" onClick={onShare}>שיתוף</Button>
          <a href={src} download className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-control-line px-4 text-[0.95rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-ink/[0.06]">
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
        <p className="mt-0.5 truncate text-small text-muted">
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
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-[1.0625rem] font-semibold transition-colors select-none hover:bg-mist/60 focus-visible:-outline-offset-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Tri className="text-ink transition-transform duration-200 group-open:-rotate-90" size="0.7em" />
        <span className="min-w-0">{q}</span>
      </summary>
      <div className="px-4 pb-4 ps-[2.15rem] text-ink-soft sm:px-5 sm:ps-[2.4rem]">{children}</div>
    </details>
  );
}

const wazeUrl = (place: string) => `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes`;

export function Faq({ event }: { event: PublicEvent | null }) {
  const price = priceOf(event);
  const note = paymentNoteOf(event);
  const place = event?.location ?? null;
  return (
    <section aria-labelledby="friday-faq">
      <h2 id="friday-faq" className={H2}>כדאי לדעת</h2>
      <div className="mt-3 divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper lg:mt-4">
        <Question q="כמה זה עולה?">
          {isPriced(price) ? (
            <>
              ההשתתפות עולה <span className="num font-semibold text-ink">{fmtMoney(price)}</span>.{' '}
              {event?.payment_url ? 'משלמים אחרי ההרשמה, בקישור לתשלום.' : 'משלמים בכניסה למפגש.'}
              {note && <> {endSentence(note)}</>}
            </>
          ) : price === 0 ? (
            'ההשתתפות ללא עלות.'
          ) : (
            'ההשתתפות בתשלום סמלי, הפרטים בהרשמה.'
          )}
        </Question>
        {place && (
          <Question q="איפה זה?">
            <p>{place}</p>
            <a href={wazeUrl(place)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-tide underline underline-offset-2">
              ניווט ב-Waze
              <span className="sr-only">(נפתח בחלון חדש)</span>
            </a>
          </Question>
        )}
        <Question q="מה להביא?">בגדים נוחים ובקבוק מים. את השאר אנחנו מביאים.</Question>
        <Question q="אפשר להביא חבר או חברה?">כן, ובשמחה. כל אחד נרשם בעצמו דרך הקישור, אז פשוט שלחו להם אותו.</Question>
      </div>
    </section>
  );
}

// ───────────── sharing ─────────────

/** The closing band: navy, stripes from the corner, the page link to copy or send on WhatsApp. */
export function ShareBand({ url, message, onCopy }: { url: string; message: string; onCopy: () => void }) {
  return (
    <section aria-labelledby="friday-share" className="relative -mx-5 overflow-hidden bg-ink text-light sm:mx-0 sm:rounded-[var(--radius-panel)]">
      <Stripes width={220} height={64} unit={18} dir="fall" count={3} offset={0} className="absolute top-0 left-0 h-16 w-[220px] text-light lg:top-auto lg:bottom-0 lg:h-full lg:w-[30%]" />
      <div className={cx('relative px-5 pt-20 pb-7 sm:px-7 lg:flex lg:items-end lg:justify-between lg:gap-10 lg:py-10 lg:pe-[34%]')}>
        <div>
          <h2 id="friday-share" className="font-display text-[1.75rem] leading-tight lg:text-[2.25rem]">שתפו עם מי שצריך את זה</h2>
          <p className="mt-2 max-w-md text-light/90">
            מכירים לוחם או לוחמת שהשישי הזה בדיוק בשבילם? שלחו להם את הקישור לדף.
          </p>
          <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
            <Button variant="light" icon="copy" onClick={onCopy}>העתקת הקישור</Button>
            <ExternalButton href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`} variant="onDark" icon="message">
              שליחה בוואטסאפ
            </ExternalButton>
          </div>
        </div>
      </div>
    </section>
  );
}
