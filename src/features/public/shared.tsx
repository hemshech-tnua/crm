import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong, fmtTime } from '@/lib/dates';
import { Button, ButtonLink, ExternalButton, cx } from '@/ui/kit';
import { useCopy } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { downloadIcs, googleCalendarUrl } from './calendar';
import { Glyph } from './marks';

/** The one saffron moment of a screen: a check that draws itself (static when reduced motion is on). */
export function SuccessMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-24 w-24' : 'h-20 w-20';
  return (
    <div className={cx('mx-auto flex items-center justify-center rounded-full bg-light text-ink', box)} aria-hidden="true">
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

/** A calm, non-saffron mark for "noted, but not final" (waitlist). */
export function WaitMark() {
  return (
    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-tide-wash text-tide-deep" aria-hidden="true">
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
        size === 'xl' ? 'text-[2.6rem] sm:text-[3rem]' : 'text-[2.25rem] sm:text-[2.5rem]',
        className,
      )}>
      {children}
    </h1>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return <h2 id={id} className="text-[1.1rem] font-bold">{children}</h2>;
}

/** A quiet block on paper for one follow-up action (calendar, invite, personal link). */
export function Block({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[var(--radius-panel)] border border-line-soft bg-paper p-4 sm:p-5', className)}>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function CalendarButtons({ event }: { event: PublicEvent }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" icon="calendar" onClick={() => downloadIcs(event)}>הוספה ליומן</Button>
      <ExternalButton href={googleCalendarUrl(event)} variant="ghost" icon="external">ביומן Google</ExternalButton>
    </div>
  );
}

export function inviteMessage(event: PublicEvent | null): string {
  if (event) {
    return `נרשמתי ל${event.title} של המשך תנועה, ${fmtDayLong(event.starts_at)} ב-${fmtTime(event.starts_at)}. בא לך להצטרף? הנה קישור להרשמה:`;
  }
  return 'מכיר/ה את המשך תנועה? מפגשי שישי של תנועה, הרצאה, ארוחת בוקר וחברים. בא לך להצטרף? כל המפגשים הקרובים כאן:';
}

/** "Invite a friend": the personal link (so the friend counts as brought by you). Web Share when the phone has it. */
export function InviteBlock({ url, message, title = 'הזמינו חבר/ה' }: { url: string; message: string; title?: ReactNode }) {
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
      <p className="text-[0.95rem] text-ink-soft">
        מכירים עוד חברים מהמילואים? שלחו להם את הקישור האישי שלך, כך נדע שהגיעו דרכך.
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
        <Button variant="secondary" icon="copy" onClick={() => copy(url, 'הקישור הועתק')}>העתקת הקישור</Button>
      </div>
    </Block>
  );
}

/** The personal management link, shown once after registering. */
export function PersonalLink({ url, token, waitlist }: { url: string; token: string; waitlist?: boolean }) {
  const copy = useCopy();
  return (
    <Block title="הקישור האישי שלך">
      <p className="text-[0.95rem] text-ink-soft">
        {waitlist
          ? 'שמרו את הקישור כדי לבדוק את המקום שלכם בתור או לצאת מרשימת ההמתנה.'
          : 'שמרו את הקישור כדי לבטל או לתת משוב אחרי המפגש.'}
      </p>
      <p dir="ltr" className="num mt-3 truncate rounded-[var(--radius-control)] bg-mist px-3 py-2.5 text-left text-sm text-ink-soft">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" icon="copy" onClick={() => copy(url, 'הקישור הועתק. כדאי לשמור אותו.')}>העתקת הקישור</Button>
        <ButtonLink to={`/m/${token}`} variant="ghost">לעמוד ההרשמה שלי</ButtonLink>
      </div>
    </Block>
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
    <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] bg-mist-deep/70 px-3.5 py-3 text-sm leading-relaxed text-ink-soft">
      <Icon name="shield" size={18} className="mt-0.5 text-tide" />
      <p>
        {children ?? (
          <>
            הפרטים משמשים לניהול ההרשמה וההגעה למפגשים וכדי לחזור אליך לגביהם. אין חובה חוקית למסור אותם, אבל בלעדיהם אי אפשר
            להירשם. רק צוות העמותה רואה אותם, כל אחד לפי תפקידו.{' '}
          </>
        )}
        <a href="#/privacy" target="_blank" rel="noopener" className="font-semibold text-tide underline underline-offset-2">
          מדיניות הפרטיות
        </a>
      </p>
    </div>
  );
}
