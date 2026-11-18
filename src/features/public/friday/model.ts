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
  /** With nothing bookable: the earliest Friday meeting we know of (full, or registration not open yet). */
  known: PublicEvent | null;
};

export function fridayPlan(events: PublicEvent[] | undefined, now = Date.now()): FridayPlan {
  const fridays = (events ?? [])
    .filter((e) => e.type === 'friday' && e.status !== 'cancelled' && startMs(e) > now)
    .sort((a, b) => startMs(a) - startMs(b));
  const next = fridays.find(bookable) ?? null;
  if (!next) return { next: null, later: [], known: fridays[0] ?? null };
  const later = fridays.filter((e) => e !== next && startMs(e) >= startMs(next)).slice(0, 3);
  return { next, later, known: null };
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

/** The label of the main call to action. */
export const ctaLabel = (e: PublicEvent) => (e.is_full ? 'הכניסו אותי לרשימת ההמתנה' : 'שמרו לי מקום');

/** `time` is a clock time; `until` marks the end of the morning ("עד 11:30"). `note` is a second line under the detail. */
export type ProgramItem = { time: string | null; until?: boolean; title: string; detail: string | null; note?: string | null };

/**
 * A Friday morning for participants (the team's 08:15 setup is not shown). Start and end come from the meeting when
 * there is one; the activity and the guest lecture too. The times in between are not published, so they are not guessed.
 * The line about fitness levels appears only once it is confirmed (FRIDAY_FACTS.allLevels).
 */
export function program(e: PublicEvent | null, facts = FRIDAY_FACTS): ProgramItem[] {
  return [
    {
      time: e ? fmtTime(e.starts_at) : '09:00',
      title: 'אימון',
      // the row is already titled 'אימון': drop it from the start of the activity ("אימון קרוספיט…" → "קרוספיט…")
      detail: (e && activityText(e)?.replace(/^אימון\s+/, '')) || 'יוגה או אימון פונקציונלי',
      note: facts.allLevels ? 'מתאים לכל רמות הכושר.' : null,
    },
    { time: null, title: 'הרצאת אורח', detail: (e && lectureText(e)) ?? null },
    { time: e ? fmtTime(e.ends_at) : '11:30', until: true, title: 'קפה, ארוחת בוקר וזמן ביחד', detail: 'בלי לחץ. יושבים, מדברים, מכירים.' },
  ];
}

/** The short "no strings" points of the navy strip; the fitness one and the rhythm only once the team confirms them. */
export function lowThreshold(facts = FRIDAY_FACTS): string[] {
  return [
    'בלי דרגות, בלי מסדרים',
    'בלי התחייבות',
    ...(facts.allLevels ? ['לכל רמות הכושר'] : []),
    'ביטול בקישור האישי',
    ...(facts.frequency ? [`שישי בבוקר, ${facts.frequency}`] : []),
  ];
}
