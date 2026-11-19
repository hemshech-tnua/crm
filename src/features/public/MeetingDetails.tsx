// "כל הפרטים על המפגש": everything about one meeting, with the people who lead it. One view, two containers:
// the page #/e/<code> (from the home page, #/friday and the personal page) and a sheet over the registration page
// (#/r/<code>?d=1), which keeps the typed form or the success screen underneath.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import type { PublicEvent, PublicPerson } from '@/lib/types';
import { fmtDayLong } from '@/lib/dates';
import { errorCode, errorMessage } from '@/lib/errors';
import { fmtMoney, isPriced } from '@/lib/money';
import { personPhotoUrl } from '@/lib/supabase';
import { Badge, ButtonLink, EmptyState, ErrorBox, Skeleton, buttonClass, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { Stripes } from '@/ui/Shapes';
import { usePublicEvent } from './api';
import { savedToken } from './device';
import { availability } from './EventTicket';
import { keepName, timeRange } from './eventText';
import { bookable, ctaLabel, program } from './friday/model';
import { wazeUrl, usePageTitle } from './shared';
import { trackingQuery } from './tracking';

type Mode = 'page' | 'sheet';

// ───────────── when there is something to show ─────────────

const personHasDetails = (p: PublicPerson) => !!(p.photo_path || p.line?.trim() || p.about?.trim());

/**
 * The trigger appears only when the view adds something: a person with a photo, a line or a few words, or a
 * description of the lecture. Elsewhere than the registration page the meeting's description counts too; there it
 * is already on the ticket, so on its own it does not.
 */
export function hasDetails(e: PublicEvent, where: 'register' | 'other' = 'other'): boolean {
  if ((e.people ?? []).some(personHasDetails)) return true;
  if (e.lecture_description?.trim()) return true;
  return where !== 'register' && !!e.description?.trim();
}

// A real secondary button in the page's language: navy frame, bold label, the people icon (it leads to who is with us),
// the width of the call to action above it. It fills navy on hover and stays clearly second to «שמרו לי מקום».
const TRIGGER = buttonClass('secondary', 'md', 'min-w-44 gap-2 border-2 border-ink text-ink hover:border-ink hover:bg-ink hover:text-light active:bg-ink-soft', true);

/**
 * How wide the trigger is: false = its own width; 'always' = the full width (under the ticket on #/r); 'phone' = full
 * width on a phone and, from sm up, the same width as the «שמרו לי מקום» button above it (CTA_WIDTH), so they line up.
 */
type Wide = false | 'always' | 'phone';
export const CTA_WIDTH = 'sm:w-auto sm:min-w-[23rem]';
const WRAP: Record<string, string> = { false: 'w-fit', always: 'w-full', phone: 'w-full sm:w-fit' };
const FIT: Record<string, string> = { false: '', always: 'w-full', phone: `w-full ${CTA_WIDTH}` };

/** «כל הפרטים על המפגש» as a link to the page (#/e/<code>), keeping ?ref and utm_*. */
export function DetailsLink({ event, query = '', wide = false, className }: { event: PublicEvent; query?: string; wide?: Wide; className?: string }) {
  if (!hasDetails(event)) return null;
  // on its own line, under the call to action and its helper text
  return (
    <div className={cx('flex', WRAP[String(wide)], className)}>
      <Link to={`/e/${event.code}${query}`} className={cx(TRIGGER, FIT[String(wide)])} data-testid="details-trigger">
        <Icon name="people" size={18} />
        כל הפרטים על המפגש
      </Link>
    </div>
  );
}

/** «כל הפרטים על המפגש» as a button that opens the sheet (the registration page and its success screen). */
export function DetailsButton({ event, onOpen, wide = false, className }: { event: PublicEvent; onOpen: () => void; wide?: Wide; className?: string }) {
  if (!hasDetails(event, 'register')) return null;
  return (
    <div className={cx('flex', WRAP[String(wide)], className)}>
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className={cx(TRIGGER, FIT[String(wide)])} data-testid="details-trigger">
        <Icon name="people" size={18} />
        כל הפרטים על המפגש
      </button>
    </div>
  );
}

// ───────────── the shared view ─────────────

/** Section heading: h2 on the page, h3 inside the sheet (whose own title is the h2). */
function SectionHead({ mode, id, children }: { mode: Mode; id: string; children: ReactNode }) {
  const H = mode === 'page' ? 'h2' : 'h3';
  return <H id={id} className="font-display text-section lg:text-[1.5rem] lg:leading-tight">{children}</H>;
}

/** The navy header: the meeting's name and when. Stripes only in the top-left corner, clear of the text. */
function Header({ event: e, mode }: { event: PublicEvent; mode: Mode }) {
  const Title = mode === 'page' ? 'h1' : 'p';
  return (
    <header className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink px-5 pt-5 pb-6 text-light sm:px-7 sm:pt-6 sm:pb-7">
      <Stripes width={150} height={44} unit={14} dir="fall" count={3} offset={0} className="absolute top-0 left-0 h-11 w-[150px] text-light" />
      <div className="relative">
        {mode === 'page' && <p className="text-small font-semibold text-light/85">כל הפרטים על המפגש</p>}
        <Title className={cx('font-display text-[1.75rem] leading-tight text-balance sm:text-title', mode === 'page' && 'mt-1.5')}>
          {keepName(e.title)}
        </Title>
        <p className="mt-2 text-body text-light/90">
          {fmtDayLong(e.starts_at)}&nbsp;· <span className="num">{timeRange(e)}</span>
        </p>
      </div>
    </header>
  );
}

const TITLES = /^(ד["״]ר|פרופ['׳]?|הרב|הרבנית)$/;
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => !TITLES.test(w));
  return words.slice(0, 2).map((w) => w[0]).join('');
}

/** The chip on the card: the label the team wrote, or a neutral default from the role. */
function roleChip(p: PublicPerson, e: PublicEvent): string {
  if (p.label?.trim()) return p.label.trim();
  if (p.role === 'speaker') return 'הרצאת אורח';
  return e.activity_name?.trim() ? `אימון ${e.activity_name.trim()}` : 'אימון';
}

/** A few words about the person: four lines, then «קראו עוד» when there is more. */
function About({ text, name, id }: { text: string; name: string; id: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <div className="mt-3">
      <p ref={ref} id={id} className={cx('text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-soft', !open && 'line-clamp-4')}>
        {text}
      </p>
      {(long || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={open ? `פחות על ${name}` : `קראו עוד על ${name}`}
          onClick={() => setOpen((o) => !o)}
          className="-my-1 inline-flex min-h-11 items-center font-semibold text-tide underline underline-offset-4 hover:text-ink-soft"
        >
          {open ? 'פחות' : 'קראו עוד'}
        </button>
      )}
    </div>
  );
}

function PersonCard({ person: p, event: e, mode, index }: { person: PublicPerson; event: PublicEvent; mode: Mode; index: number }) {
  const H = mode === 'page' ? 'h3' : 'h4';
  const about = p.about?.trim();
  return (
    <li className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 lg:grid-rows-[auto_1fr] rounded-[var(--radius-panel)] border border-edge bg-paper p-4 sm:p-5 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-x-6" data-testid="person-card">
      <div className="h-[120px] lg:row-span-2 w-[96px] overflow-hidden rounded-[var(--radius-control)] bg-ink lg:h-[200px] lg:w-[160px]">
        {p.photo_path ? (
          <img
            src={personPhotoUrl(p.photo_path)}
            alt={p.name}
            width={160}
            height={200}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <span aria-hidden="true" className="flex h-full w-full items-center justify-center font-display text-[2rem] text-light lg:text-[3rem]">
            {initials(p.name)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <H className="text-heading font-bold">{keepName(p.name)}</H>
        <p className="mt-1.5"><Badge tone="light">{roleChip(p, e)}</Badge></p>
        {p.line?.trim() && <p className="mt-2 text-[0.9375rem] leading-snug font-medium text-ink">{keepName(p.line.trim())}</p>}
      </div>
      {about && (
        <div className="col-span-2 min-w-0 lg:col-span-1 lg:col-start-2">
          <About text={about} name={p.name} id={`about-${mode}-${index}`} />
        </div>
      )}
    </li>
  );
}

function People({ event: e, mode }: { event: PublicEvent; mode: Mode }) {
  const people = e.people ?? [];
  if (!people.length) return null;
  const id = `${mode}-people`;
  return (
    <section aria-labelledby={id}>
      <SectionHead mode={mode} id={id}>{e.type === 'friday' ? 'מי איתנו בבוקר' : 'מי איתנו'}</SectionHead>
      <ul className="mt-3 flex flex-col gap-3 lg:mt-4 lg:gap-4">
        {people.map((p, i) => <PersonCard key={`${p.role}-${i}`} person={p} event={e} mode={mode} index={i} />)}
      </ul>
    </section>
  );
}

function Lecture({ event: e, mode }: { event: PublicEvent; mode: Mode }) {
  const topic = e.lecture_topic?.trim();
  const text = e.lecture_description?.trim();
  if (!topic && !text) return null;
  const id = `${mode}-lecture`;
  return (
    <section aria-labelledby={id}>
      <SectionHead mode={mode} id={id}>על ההרצאה</SectionHead>
      <div className="mt-3 rounded-[var(--radius-panel)] border border-edge bg-paper p-4 sm:p-5 lg:mt-4">
        {topic && (
          <p className="text-heading leading-snug font-bold text-ink">
            {keepName(topic)}
            {e.speaker_name && <span className="mt-0.5 block text-body font-medium text-ink-soft">עם {keepName(e.speaker_name)}</span>}
          </p>
        )}
        {text && <p className={cx('text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-soft', topic && 'mt-3')}>{keepName(text)}</p>}
      </div>
    </section>
  );
}

/** Friday: the morning in order (start and end from the meeting, nothing guessed in between). Otherwise: the description. */
function Morning({ event: e, mode }: { event: PublicEvent; mode: Mode }) {
  const id = `${mode}-morning`;
  if (e.type !== 'friday') {
    if (!e.description?.trim()) return null;
    return (
      <section aria-labelledby={id}>
        <SectionHead mode={mode} id={id}>על המפגש</SectionHead>
        <p className="mt-3 rounded-[var(--radius-panel)] border border-edge bg-paper p-4 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-soft sm:p-5 lg:mt-4">
          {keepName(e.description.trim())}
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby={id}>
      <SectionHead mode={mode} id={id}>ככה נראה הבוקר</SectionHead>
      <ol className="mt-3 divide-y divide-edge rounded-[var(--radius-panel)] border border-edge bg-paper lg:mt-4">
        {program(e).map((it) => (
          <li key={it.title} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 px-4 py-3.5 sm:px-5">
            <span className="pt-0.5 text-small font-semibold text-ink-soft">
              {it.time && (
                <>
                  {it.until && 'עד '}
                  <span className="num">{it.time}</span>
                </>
              )}
            </span>
            <span className="min-w-0">
              <span className="block font-bold text-ink">{it.title}</span>
              {it.detail && <span className="mt-0.5 block text-small text-ink-soft">{keepName(it.detail)}</span>}
              {it.note && <span className="mt-0.5 block text-small font-semibold text-ink">{it.note}</span>}
            </span>
          </li>
        ))}
      </ol>
      {e.description?.trim() && (
        <p className="mt-3 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-soft">{keepName(e.description.trim())}</p>
      )}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3 sm:px-5">
      <dt className="text-small font-semibold text-muted">{term}</dt>
      <dd className="min-w-0 text-[0.9375rem] text-ink">{children}</dd>
    </div>
  );
}

function Facts({ event: e, mode }: { event: PublicEvent; mode: Mode }) {
  const friday = e.type === 'friday';
  const status = availability(e);
  const id = `${mode}-facts`;
  return (
    <section aria-labelledby={id}>
      <SectionHead mode={mode} id={id}>פרטים חשובים</SectionHead>
      <dl className="mt-3 divide-y divide-edge rounded-[var(--radius-panel)] border border-edge bg-paper lg:mt-4">
        <Fact term="מתי">
          {fmtDayLong(e.starts_at)}
          <span className="block text-ink-soft"><span className="num">{timeRange(e)}</span></span>
        </Fact>
        {e.location && (
          <Fact term="איפה">
            {e.location}
            <a href={wazeUrl(e.location)} target="_blank" rel="noopener noreferrer" className="-my-1 flex min-h-11 w-fit items-center font-semibold text-tide underline underline-offset-4">
              ניווט ב-Waze<span className="sr-only"> (נפתח בחלון חדש)</span>
            </a>
          </Fact>
        )}
        {friday && <Fact term="קפה ונשנושים">את הקפה והנשנושים אנחנו&nbsp;מביאים.</Fact>}
        {isPriced(e.price) && (
          <Fact term="השתתפות">
            <span className="num font-semibold">{fmtMoney(e.price)}</span>
            {e.payment_note && <span className="block text-small text-muted">{e.payment_note}</span>}
          </Fact>
        )}
        {friday && <Fact term="מה להביא">בגדים ונעליים נוחים לאימון, ובקבוק מים.</Fact>}
        <Fact term="הרשמה"><Badge tone={status.tone}>{status.text}</Badge></Fact>
      </dl>
    </section>
  );
}

/**
 * The view itself, the same on the page and in the sheet: who is with us, the lecture, the morning, the important
 * details. Wide screen, page: the header, the details and the call to action stay in a column beside the content.
 */
export function MeetingDetails({ event: e, mode, cta }: { event: PublicEvent; mode: Mode; cta?: ReactNode }) {
  if (mode === 'sheet') {
    return (
      <div className="flex flex-col gap-7">
        <Header event={e} mode={mode} />
        <People event={e} mode={mode} />
        <Lecture event={e} mode={mode} />
        <Morning event={e} mode={mode} />
        <Facts event={e} mode={mode} />
      </div>
    );
  }
  // phone: one column in reading order (the side column dissolves into it); wide screen: two columns like #/r
  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-6">
        <div className="order-1"><Header event={e} mode={mode} /></div>
        <div className="order-3"><Facts event={e} mode={mode} /></div>
        {cta && <div className="order-4">{cta}</div>}
      </div>
      <div className="order-2 flex min-w-0 flex-col gap-8">
        <People event={e} mode={mode} />
        <Lecture event={e} mode={mode} />
        <Morning event={e} mode={mode} />
      </div>
    </div>
  );
}

// ───────────── the page: #/e/<code> ─────────────

/** The call to action: to the registration page (keeping ?ref and utm_*), or to their own page if this phone registered. */
function PageCta({ event: e, query }: { event: PublicEvent; query: string }) {
  const token = savedToken(e.code);
  const open = bookable(e);
  return (
    <div
      data-testid="details-cta"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-edge bg-paper/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
    >
      <div className="mx-auto max-w-xl lg:max-w-none">
        {token ? (
          <ButtonLink to={`/m/${token}`} size="lg" cta className="w-full">לעמוד ההרשמה שלי</ButtonLink>
        ) : open ? (
          <ButtonLink to={`/r/${e.code}${query}`} size="lg" cta className="w-full">
            {ctaLabel(e)}
            <span className="sr-only">: {e.title}, {fmtDayLong(e.starts_at)}</span>
          </ButtonLink>
        ) : (
          <ButtonLink to={`/${query}`} variant="secondary" size="lg" className="w-full">למפגשים הקרובים</ButtonLink>
        )}
      </div>
    </div>
  );
}

export function MeetingPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const query = trackingQuery(params);
  const location = useLocation();
  const navigate = useNavigate();
  const event = usePublicEvent(code, null);
  usePageTitle(event.data ? `פרטי המפגש: ${event.data.title}` : null);
  const home = `/${query}`;
  // «חזרה»: back where they came from in this app; opened from a shared link, to the meetings
  const back = location.key !== 'default';

  if (event.isPending) return <Skeleton lines={8} className="py-6" />;
  if (event.isError) {
    const c = errorCode(event.error);
    if (c === 'registration_not_open') {
      return (
        <EmptyState icon="calendar" title="ההרשמה עוד לא נפתחה" action={<ButtonLink to={home}>למפגשים הפתוחים עכשיו</ButtonLink>}>
          המפגש הזה עוד בהכנה. נסו שוב בקרוב, או עקבו אחרינו בקבוצות ובאינסטגרם.
        </EmptyState>
      );
    }
    return c === 'event_not_found' ? (
      <EmptyState icon="calendar" title="לא מצאנו את המפגש" action={<ButtonLink to={home}>למפגשים הקרובים</ButtonLink>}>
        ייתכן שהקישור ישן או שהוקלד לא נכון.
      </EmptyState>
    ) : (
      <ErrorBox error={errorMessage(event.error)} onRetry={() => event.refetch()} />
    );
  }

  return (
    <div className="pb-24 lg:pb-0">
      {back ? (
        <button type="button" onClick={() => navigate(-1)} className="-mt-2 mb-2 inline-flex min-h-11 items-center gap-1 text-small font-semibold text-tide hover:underline">
          <Icon name="back" size={16} />
          חזרה
        </button>
      ) : (
        <Link to={home} className="-mt-2 mb-2 inline-flex min-h-11 items-center gap-1 text-small font-semibold text-tide hover:underline">
          <Icon name="back" size={16} />
          חזרה
        </Link>
      )}
      <MeetingDetails event={event.data} mode="page" cta={<PageCta event={event.data} query={query} />} />
    </div>
  );
}

// ───────────── the sheet over the registration page ─────────────

/**
 * A native modal dialog: full screen on a phone, centered on a wide screen. Opening moves focus to «סגירה»; Esc, the
 * close button and the phone's back button close it (the parent owns `open`, kept in the URL as ?d=1), and focus
 * returns to what opened it. The page under it does not scroll while it is open.
 */
export function MeetingSheet({ event: e, open, onClose }: { event: PublicEvent; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      d.scrollTop = 0;
      closeBtn.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  // the dialog closed (by the parent, after Esc or back): focus goes back to the trigger
  const restore = () => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="details-sheet-title"
      onCancel={(ev) => { ev.preventDefault(); onClose(); }}
      onClose={restore}
      onClick={(ev) => { if (ev.target === ref.current) onClose(); }}
      className="sheet-in m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-sky p-0 text-ink backdrop:bg-ink/55 lg:m-auto lg:h-auto lg:max-h-[90dvh] lg:w-[calc(100%-3rem)] lg:max-w-3xl lg:rounded-[var(--radius-panel)] lg:shadow-2xl"
      data-testid="details-sheet"
    >
      {open && (
        <>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-edge bg-paper py-1.5 ps-5 pe-2 sm:ps-6">
            <h2 id="details-sheet-title" className="text-heading font-bold">כל הפרטים על המפגש</h2>
            <button
              ref={closeBtn}
              type="button"
              onClick={onClose}
              className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-2 font-semibold text-ink hover:bg-ink/[0.06]"
            >
              <Icon name="close" size={20} />
              {/* the visible word starts the accessible name (WCAG 2.5.3), then what it closes */}
              <span>סגירה<span className="sr-only"> של פרטי המפגש</span></span>
            </button>
          </div>
          <div className="px-5 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-6 lg:pb-8">
            <MeetingDetails event={e} mode="sheet" />
          </div>
        </>
      )}
    </dialog>
  );
}

/** The sheet's state lives in the URL (?d=1), so the phone's back button closes it and the page under it stays as it was. */
export function useDetailsSheet() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const open = params.get('d') === '1';
  const show = () => {
    const next = new URLSearchParams(params);
    next.set('d', '1');
    navigate({ search: `?${next.toString()}` }, { state: { detailsSheet: true } });
  };
  const hide = () => {
    if ((location.state as { detailsSheet?: boolean } | null)?.detailsSheet) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete('d');
    setParams(next, { replace: true });
  };
  return { open, show, hide };
}
