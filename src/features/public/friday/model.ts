// What the Friday landing page shows, derived from the public event list. Pure functions, no React.
import type { PublicEvent } from '@/lib/types';
import { fmtTime } from '@/lib/dates';
import { activityText, lectureText } from '../eventText';
import { FRIDAY_FACTS } from './facts';

const startMs = (e: PublicEvent) => new Date(e.starts_at).getTime();

/** Someone can still put their name down: registration open and a seat (or the waitlist) left. */
export const bookable = (e: PublicEvent) =>
  e.status !== 'cancelled' && e.registration_open && (!e.is_full || e.waitlist_enabled);

export type FridayPlan = {
  /** The meeting the page is about: the earliest Friday meeting that takes registrations. */
  next: PublicEvent | null;
  /** The Friday meetings after it (up to three), for "עוד מפגשים". */
  later: PublicEvent[];
  /** Upcoming meetings of other kinds (up to three), listed with their kind under "עוד מפגשים". */
  others: PublicEvent[];
  /** With nothing bookable: the earliest Friday meeting we know of (full, or registration not open yet). */
  known: PublicEvent | null;
};

export function fridayPlan(events: PublicEvent[] | undefined, now = Date.now()): FridayPlan {
  const upcoming = (events ?? [])
    .filter((e) => e.status !== 'cancelled' && startMs(e) > now)
    .sort((a, b) => startMs(a) - startMs(b));
  const fridays = upcoming.filter((e) => e.type === 'friday');
  const others = upcoming.filter((e) => e.type !== 'friday').slice(0, 3);
  const next = fridays.find(bookable) ?? null;
  if (!next) return { next: null, later: [], others, known: fridays[0] ?? null };
  const later = fridays.filter((e) => e !== next && startMs(e) >= startMs(next)).slice(0, 3);
  return { next, later, others, known: null };
}

/** The participation fee, read defensively: the field is new and may be missing, null, or a numeric string. */
export function priceOf(e: PublicEvent | null | undefined): number | null {
  const raw: unknown = e?.price;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function paymentNoteOf(e: PublicEvent | null | undefined): string | null {
  const raw: unknown = e?.payment_note;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * The label of the main call to action, the same on every public page: it says what happens next. A meeting with a
 * payment link is paid during registration, so its button says so; a full one leads to the waiting list.
 */
export const ctaLabel = (e: PublicEvent) =>
  e.is_full ? 'להרשמה לרשימת ההמתנה' : e.payment_url && Number(e.price) > 0 ? 'להרשמה ולתשלום' : 'להרשמה';

/** `time` is a clock time; `until` marks the end of the morning ("עד 11:30"). `note` is a second line under the detail. */
export type ProgramItem = { time: string | null; until?: boolean; title: string; detail: string | null; note?: string | null };

/**
 * A Friday morning for participants (the team's 08:15 setup is not shown). Start and end come from the meeting when
 * there is one; the activity and the guest lecture too. The times in between are not published, so they are not guessed.
 * The line about fitness levels appears only once it is confirmed (FRIDAY_FACTS.allLevels).
 */
export function program(e: PublicEvent | null, facts = FRIDAY_FACTS): ProgramItem[] {
  // "אימון קרוספיט" is already a full title: use it as the row's title and put the coach under it ("עם יוגב מלר"),
  // so "אימון" is not said twice and the activity's name is never cut. Other activities ("יוגה") keep the row title
  // 'אימון' with the activity as the detail.
  const activity = e?.activity_name?.trim() || null;
  const ownTitle = activity && /^אימון\s/.test(activity) ? activity : null;
  return [
    {
      time: e ? fmtTime(e.starts_at) : '09:00',
      title: ownTitle ?? 'אימון',
      detail: ownTitle
        ? (e?.instructor_name ? `עם ${e.instructor_name}` : null)
        : (e && activityText(e)) || 'יוגה או אימון פונקציונלי',
      note: facts.allLevels ? 'מתאים לכל רמות הכושר.' : null,
    },
    { time: null, title: 'קפה ונשנושים', detail: 'בלי לחץ. יושבים, מדברים, מכירים.' },
    { time: e ? fmtTime(e.ends_at) : '11:30', until: true, title: 'הרצאת אורח', detail: (e && lectureText(e)) ?? null },
  ];
}

/**
 * The short "no strings" points of the navy strip, each a few words that fit one line on a phone; the rhythm only once
 * the team confirms it. "בלי מעגל שיחה" answers the worry that this is therapy (the question in the FAQ says it at
 * length). Fitness levels are said in the program and the FAQ, so not a third time here.
 */
export function lowThreshold(facts = FRIDAY_FACTS): string[] {
  return [
    'בלי דרגות, בלי מסדרים',
    'בלי מעגל שיחה',
    'בלי התחייבות',
    ...(facts.frequency ? [facts.frequency] : []),
  ];
}
