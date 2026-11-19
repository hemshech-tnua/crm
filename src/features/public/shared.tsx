import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { Button, ButtonLink, ExternalButton, cx } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { Tri } from '@/ui/Shapes';
import { downloadIcs, googleCalendarUrl } from './calendar';
import { Glyph } from './marks';
import { useOrgInfo } from './api';
import { formatPhone, whatsappLink } from '@/lib/phone';
import { fmtMoney, isPriced } from '@/lib/money';
import { FRIDAY_FACTS } from './friday/facts';

/**
 * The browser tab's title on a public page: "מפגשי שישי | המשך תנועה". Without one (null) the default title of
 * index.html stays; leaving the page puts back the title it found.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} | המשך תנועה`;
    return () => {
      document.title = before;
    };
  }, [title]);
}

/** The one highlighted moment of a screen: a beige check that draws itself on navy (static when reduced motion is on). */
export function SuccessMark({ size = 'md', className = 'mx-auto' }: { size?: 'md' | 'lg'; className?: string }) {
  const box = size === 'lg' ? 'h-24 w-24' : 'h-20 w-20';
  return (
    <div className={cx(className, 'flex items-center justify-center rounded-[var(--radius-control)] bg-ink text-light', box)} aria-hidden="true">
      <svg width={size === 'lg' ? 48 : 40} height={size === 'lg' ? 48 : 40} viewBox="0 0 24 24">
        <path
          d="M20 6 9 17l-5-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="friday-line-path"
          style={{ '--len': 24 } as CSSProperties}
        />
      </svg>
    </div>
  );
}

/** A calm mark for "noted, but not final" (waitlist): navy on paper, quieter than the navy success mark. */
export function WaitMark() {
  return (
    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[var(--radius-control)] border border-edge bg-paper text-ink" aria-hidden="true">
      <Glyph name="clock" size={40} />
    </div>
  );
}

/** The heading of a result screen: takes focus so screen readers announce the new state, and scrolls to top. */
export function ResultTitle({ children, className = '', size = 'md' }: { children: ReactNode; className?: string; size?: 'md' | 'xl' }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={cx(
        'font-display leading-tight outline-none',
        size === 'xl' ? 'text-[2.6rem] sm:text-[3rem]' : 'text-title sm:text-[2.5rem]',
        className,
      )}>
      {children}
    </h1>
  );
}

/** A list with the brand's triangle bullet ◀ (book p.41): at cap height, in the text colour, pointing the reading way. */
export function TriList({ items, className = '' }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cx('flex flex-col gap-1.5', className)}>
      {items.map((it, i) => (
        <li key={i} className="flex items-baseline gap-2.5">
          <Tri className="shrink-0 text-ink" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return <h2 id={id} className="text-heading font-bold">{children}</h2>;
}

/** A quiet block on paper for one follow-up action (calendar, invite, personal link). */
export function Block({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[var(--radius-panel)] border border-edge bg-paper p-4 sm:p-5', className)}>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function CalendarButtons({ event }: { event: PublicEvent }) {
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      <Button variant="secondary" icon="calendar" onClick={() => downloadIcs(event)}>הוספה ליומן</Button>
      <ExternalButton href={googleCalendarUrl(event)} variant="ghost" icon="external">הוספה ליומן Google</ExternalButton>
    </div>
  );
}

export function inviteMessage(event: PublicEvent | null): string {
  if (event) {
    // a title that already names the association ("ערב לוחמות - "המשך תנועה"") does not get it twice
    const of = /המשך תנועה/.test(event.title) ? '' : ' של המשך תנועה';
    return `נרשמתי ל${event.title}${of}, ${fmtDayLong(event.starts_at)} ב-${fmtTime(event.starts_at)}. בא לך לבוא איתי? ככה אף אחד מאיתנו לא מגיע לבד.`;
  }
  return 'שמעת על המשך תנועה? מפגשי שישי ללוחמים וללוחמות: אימון, קפה ונשנושים והרצאה. בא לך לבוא איתי? כל המפגשים הקרובים כאן:';
}

/** "Invite a friend": the personal link (so the friend counts as brought by you). Web Share when the phone has it. */
export function InviteBlock({ url, message, title = 'הזמינו עוד חברים', lead }: {
  url: string; message: string; title?: ReactNode;
  /** the text above the buttons; by default the general "invite more friends" one */
  lead?: ReactNode;
}) {
  const copy = useCopy();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    try {
      await navigator.share({ title: 'המשך תנועה', text: message, url });
    } catch (err) {
      // closing the share sheet is not an error; anything else falls back to copying
      if ((err as DOMException | undefined)?.name !== 'AbortError') void copy(url, 'הקישור הועתק');
    }
  };
  return (
    <Block title={title}>
      <p className="text-[0.9375rem] text-ink-soft">
        {lead ?? (
          <>
            מכירים עוד לוחמים ולוחמות שכדאי שיבואו?
            <span className="block">שלחו להם את קישור ההזמנה שלכם. כך&nbsp;נדע שהגיעו&nbsp;דרככם.</span>
          </>
        )}
      </p>
      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        {canShare ? (
          <Button onClick={share}>
            <Glyph name="share" />
            שיתוף הקישור
          </Button>
        ) : (
          <ExternalButton href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`} variant="primary" icon="message">
            שליחה בוואטסאפ
          </ExternalButton>
        )}
        <Button variant="secondary" icon="copy" onClick={() => copy(url, 'קישור ההזמנה הועתק')}>העתקת קישור ההזמנה</Button>
      </div>
    </Block>
  );
}

/** The personal management link, shown once after registering. */
export function PersonalLink({ url, token, waitlist }: { url: string; token: string; waitlist?: boolean }) {
  const copy = useCopy();
  return (
    <Block title={waitlist ? 'הקישור האישי שלך' : 'השתנו התוכניות?'}>
      <p className="text-[0.9375rem] text-ink-soft">
        {waitlist
          ? 'כדאי לשמור את הקישור: דרכו אפשר לבדוק את המקום שלך בתור או לצאת מרשימת ההמתנה.'
          : 'מבטלים בקישור האישי, וכך המקום עובר למישהו\u00a0אחר.'}
        <span className="mt-1 block font-semibold text-ink">הקישור אישי, לא&nbsp;לשתף.</span>
      </p>
      <p dir="ltr" className="num mt-3 truncate rounded-[var(--radius-control)] bg-mist px-3 py-2.5 text-left text-sm text-ink-soft">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" icon="copy" onClick={() => copy(url, 'הקישור האישי הועתק. כדאי לשמור אותו.')}>העתקת הקישור האישי</Button>
        <ButtonLink to={`/m/${token}`} variant="ghost">לעמוד ההרשמה שלי</ButtonLink>
      </div>
    </Block>
  );
}

export const wazeUrl = (place: string) => `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes`;
/** Public transport directions to the place (Google Maps, transit mode): works on a phone with or without the app. */
export const transitUrl = (place: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}&travelmode=transit`;

/**
 * After registering: one panel with what helps someone actually arrive. How to get there (navigation, public transport,
 * a ride), and on a Friday morning what to bring and, once the team confirms them, the reminder and who meets you.
 * Nothing here is stored; it only prompts the plan.
 */
export function BeforeYouCome({ event }: { event: PublicEvent }) {
  const place = event.location;
  const friday = event.type === 'friday';
  const f = FRIDAY_FACTS;
  const now = friday && (f.reminder || f.greeter);
  return (
    <div className="divide-y divide-edge rounded-[var(--radius-panel)] border border-edge bg-paper">
      <section aria-labelledby="after-route" className="p-4 sm:p-5">
        <SectionTitle id="after-route">איך מגיעים?</SectionTitle>
        {place && (
          <>
            <p className="mt-2 flex items-start gap-2 text-ink">
              <Glyph name="pin" className="mt-[3px]" />
              <span className="min-w-0">{place}</span>
            </p>
            <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
              <ExternalButton href={wazeUrl(place)} variant="secondary">ניווט ב-Waze</ExternalButton>
              <ExternalButton href={transitUrl(place)} variant="secondary">תחבורה ציבורית</ExternalButton>
            </div>
          </>
        )}
        <p className="mt-2 text-[0.9375rem] text-ink-soft">
          צריכים טרמפ? <ContactLine inline />
        </p>
      </section>
      {friday && (
        <section aria-labelledby="after-bring" className="p-4 sm:p-5">
          <SectionTitle id="after-bring">מה להביא</SectionTitle>
          <TriList items={['בגדים ונעליים נוחים לאימון', 'בקבוק מים']} className="mt-2 text-ink" />
          <p className="mt-2 text-[0.9375rem] text-ink-soft">את הקפה והנשנושים אנחנו&nbsp;מביאים.</p>
        </section>
      )}
      {now && (
        <section aria-labelledby="after-now" className="p-4 sm:p-5" data-fact="reminder-greeter">
          <SectionTitle id="after-now">מה הלאה</SectionTitle>
          {f.reminder && <p className="mt-2 text-[0.9375rem] text-ink-soft">{f.reminder}</p>}
          {f.greeter && <p className="mt-1 text-[0.9375rem] font-semibold text-ink">כשמגיעים, חפשו את {f.greeter}.</p>}
        </section>
      )}
    </div>
  );
}

/** Spam trap: invisible to people and screen readers, filled only by bots. The server answers "ok" and stores nothing. */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="sr-only" aria-hidden="true">
      <label>
        אתר אינטרנט (להשאיר ריק)
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

/** Short privacy notice next to every form that collects personal details (Privacy Protection Law §11 style). */
export function PrivacyNote({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-small text-ink-soft">
      <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-ink" />
      <p>
        {children ?? (
          <>
            הפרטים משמשים לניהול ההרשמה וההגעה למפגשים וכדי לחזור אליך לגביהם. אין חובה חוקית למסור אותם, אבל בלעדיהם אי אפשר
            להירשם. רק צוות העמותה רואה אותם, כל אחד לפי תפקידו.{' '}
          </>
        )}
        <a href="#/privacy" target="_blank" rel="noopener" className="font-semibold text-tide underline underline-offset-2">
          מדיניות הפרטיות
          <span className="sr-only"> (נפתח בחלון חדש)</span>
        </a>
      </p>
    </div>
  );
}

/** How to reach the team (WhatsApp/phone from Settings). Used where a participant may get stuck. */
export function ContactLine({ inline = false }: { inline?: boolean }) {
  const org = useOrgInfo();
  const phone = org.data?.contact_phone;
  if (!phone) return <>{inline ? 'פנו לצוות העמותה.' : <p className="text-sm text-muted">שאלות? פנו לצוות העמותה.</p>}</>;
  const link = (
    <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer" className="inline-block py-3 leading-5 font-semibold text-tide underline underline-offset-2">
      כתבו לנו בוואטסאפ (<span dir="ltr" className="num whitespace-nowrap">{formatPhone(phone)}</span>)
      <span className="sr-only"> (נפתח בחלון חדש)</span>
    </a>
  );
  return inline ? link : <p className="text-sm text-muted">שאלות או בקשות? {link}</p>;
}

/**
 * The participation fee after registering (and on the personal page while it is unpaid). Payment happens only on the
 * provider's own secure page, opened as a normal link: no card details ever pass through this site. Without a link,
 * the fee is paid at the entrance. Nothing is shown for a free meeting.
 */
export { payUrl, type Payer } from './payUrl';
import { payUrl, type Payer } from './payUrl';

export function PayBlock({ event, payer = null, className = '' }: { event: PublicEvent; payer?: Payer | null; className?: string }) {
  if (!isPriced(event.price)) return null;
  const amount = fmtMoney(event.price);
  return (
    <section aria-label="תשלום" className={cx('rounded-[var(--radius-panel)] border-2 border-ink bg-paper p-4 sm:p-5', className)}>
      <SectionTitle>דמי השתתפות: <span className="num">{amount}</span></SectionTitle>
      {event.payment_url ? (
        <>
          <ExternalButton href={payUrl(event.payment_url, payer)} variant="primary" size="lg" cta className="mt-3 w-full sm:w-auto">
            לתשלום <span className="num">{amount}</span>
          </ExternalButton>
          {/* one payment link serves everyone, so the team matches payments to registrations by name and phone */}
          {payUrl(event.payment_url, payer) !== event.payment_url ? (
            <p className="mt-3 text-[0.9375rem] font-semibold text-ink">
              השם והטלפון כבר ממולאים בדף התשלום. נשאר רק להוסיף אימייל לקבלה ולשלם בכרטיס&nbsp;אשראי.
            </p>
          ) : (
            <p className="mt-3 text-[0.9375rem] font-semibold text-ink">
              בדף התשלום כתבו את אותו שם ואותו טלפון שנרשמתם איתם, כדי שנדע לסמן שהתשלום שלכם&nbsp;התקבל.
            </p>
          )}
          <p className="mt-2 text-[0.9375rem] text-ink-soft">
            התשלום נעשה בדף המאובטח של חברת התשלום. אם לא מסתדר לשלם עכשיו, אפשר לשלם אחר כך בקישור האישי או בכניסה למפגש.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[0.9375rem] text-ink-soft">משלמים בכניסה למפגש.</p>
      )}
      {event.payment_note && <p className="mt-1 text-sm text-muted">{event.payment_note}</p>}
    </section>
  );
}
