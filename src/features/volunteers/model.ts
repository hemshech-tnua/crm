// Volunteers: who is needed at which meeting, and the words used for it. Pure data and functions (no React).
import { addDays, fmtDay, fmtDayLong, fmtShortDate, fmtTime, ilParts, relativeDays, todayIl } from '@/lib/dates';
import { appBase } from '@/lib/links';
import type { EventStatus, EventType, ShiftStatus, VolunteerRole } from '@/lib/types';

/** Every role a volunteer can take, in the order they are shown. */
export const ROLE_ORDER: VolunteerRole[] = ['entrance', 'setup', 'teardown', 'photo', 'food', 'other'];
export const ROLE_LABEL: Record<VolunteerRole, string> = {
  entrance: 'קבלת פנים',
  setup: 'הקמה',
  teardown: 'פירוק',
  photo: 'צילום',
  food: 'אוכל',
  other: 'אחר',
};

export type SlotDef = { role: VolunteerRole; label: string; /** how many volunteers this role needs (default 1) */ need?: number };

/**
 * The volunteer roles each kind of meeting needs. The one place to change them: the planner, the meeting's tab,
 * the summary and the messages all read this.
 */
export const SLOTS: Record<EventType, SlotDef[]> = {
  friday: [
    { role: 'entrance', label: 'קבלת פנים' },
    { role: 'setup', label: 'הקמה' },
    { role: 'teardown', label: 'פירוק' },
  ],
  bonfire: [
    { role: 'entrance', label: 'קליטה' },
    { role: 'setup', label: 'הקמה ומדורה' },
    { role: 'photo', label: 'צילום' },
  ],
  other: [
    { role: 'entrance', label: 'קבלת פנים' },
    { role: 'setup', label: 'הקמה' },
  ],
};

/** The role's name at this kind of meeting ("הקמה ומדורה" at a bonfire). */
export const roleLabel = (type: EventType | null | undefined, role: VolunteerRole) =>
  (type && SLOTS[type].find((s) => s.role === role)?.label) || ROLE_LABEL[role];

export const STATUS_LABEL: Record<ShiftStatus, string> = {
  invited: 'בהמתנה',
  confirmed: 'הגעה אושרה',
  declined: 'לא מסתדר',
  cancelled: 'בוטל',
};

/** How far ahead the planner looks, and the near window of its summary. */
export const PLAN_DAYS = 92;
export const NEAR_DAYS = 28;
/** Reminders are offered for meetings that start within this many hours. */
export const REMINDER_HOURS = 48;

export type PlanEvent = {
  id: string; title: string; type: EventType; starts_at: string; ends_at: string; location: string | null; status: EventStatus;
};
export type Shift = {
  id: string; event_id: string; volunteer_id: string; role: VolunteerRole; status: ShiftStatus; responded_at: string | null; notes: string | null;
  event: PlanEvent;
};
export type Slot = {
  def: SlotDef;
  /** this role's shifts at the meeting (not cancelled): confirmed first, then invited, then declined */
  shifts: Shift[];
  filled: number;
  confirmed: number;
  missing: number;
};

const STATUS_RANK: Record<ShiftStatus, number> = { confirmed: 0, invited: 1, declined: 2, cancelled: 3 };

/** The meeting's slots and who fills them. Roles assigned outside the standard list still show (need 0). */
export function slotsFor(event: Pick<PlanEvent, 'type'>, shifts: Shift[]): Slot[] {
  const defs = [...SLOTS[event.type]];
  for (const s of shifts) {
    if (s.status !== 'cancelled' && !defs.some((d) => d.role === s.role)) defs.push({ role: s.role, label: ROLE_LABEL[s.role], need: 0 });
  }
  return defs.map((def) => {
    const mine = shifts.filter((s) => s.role === def.role && s.status !== 'cancelled').sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
    const filled = mine.filter((s) => s.status === 'invited' || s.status === 'confirmed').length;
    const confirmed = mine.filter((s) => s.status === 'confirmed').length;
    return { def, shifts: mine, filled, confirmed, missing: Math.max(0, (def.need ?? 1) - filled) };
  });
}

export type Tally = { slots: number; filled: number; confirmed: number; missing: number; meetings: number };

/** Slots needed, filled and confirmed over a set of meetings (only the needed number counts as filled). */
export function tally(events: PlanEvent[], shiftsByEvent: Map<string, Shift[]>): Tally {
  const t: Tally = { slots: 0, filled: 0, confirmed: 0, missing: 0, meetings: events.length };
  for (const e of events) {
    for (const s of slotsFor(e, shiftsByEvent.get(e.id) ?? [])) {
      const need = s.def.need ?? 1;
      t.slots += need;
      t.filled += Math.min(need, s.filled);
      t.confirmed += Math.min(need, s.confirmed);
      t.missing += s.missing;
    }
  }
  return t;
}

export const groupByEvent = (shifts: Shift[]) => {
  const m = new Map<string, Shift[]>();
  for (const s of shifts) m.set(s.event_id, [...(m.get(s.event_id) ?? []), s]);
  return m;
};

export const isUpcoming = (e: Pick<PlanEvent, 'ends_at' | 'status'>, now = Date.now()) =>
  new Date(e.ends_at).getTime() > now && e.status !== 'cancelled' && e.status !== 'completed';

/** Starts within the next two days (or is on now): time for a reminder. */
export const remindable = (e: Pick<PlanEvent, 'starts_at' | 'ends_at' | 'status'>, now = Date.now()) =>
  isUpcoming(e, now) && new Date(e.starts_at).getTime() - now <= REMINDER_HOURS * 3600_000;

/** Before this date (Israel time) a meeting counts as "in the next 4 weeks". */
export const nearLimit = () => addDays(todayIl(), NEAR_DAYS);
export const isNear = (e: Pick<PlanEvent, 'starts_at'>) => ilParts(e.starts_at).date < nearLimit();

/** "שישי 20.11": the weekday without "יום". */
export const shortDay = (v: string) => fmtDay(v).replace(/^יום /, '');
export const dayAndDate = (v: string) => `${shortDay(v)} ${fmtShortDate(v)}`;

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

/** Within a week: a gap that has to be filled now (the warning colour is kept for these). */
export const isSoon = (e: Pick<PlanEvent, 'starts_at'>, now = Date.now()) => new Date(e.starts_at).getTime() - now <= 7 * 864e5;

/** The volunteer's personal page (hash route: the token never reaches a server log). */
export const volunteerUrl = (token: string) => `${appBase()}#/v/${token}`;

// ───────────── messages (sent by a person from their own WhatsApp; gender-neutral Hebrew, no slashes) ─────────────

export function linkMessage(name: string, shifts: Shift[], url: string): string {
  const open = shifts
    .filter((s) => (s.status === 'invited' || s.status === 'confirmed') && isUpcoming(s.event))
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  const lines = open.map((s) =>
    `▪ ${fmtDayLong(s.event.starts_at)}, ${fmtTime(s.event.starts_at)} · ${roleLabel(s.event.type, s.role)} · ${s.event.title}${s.status === 'confirmed' ? ' (כבר אישרת, תודה!)' : ''}`);
  return [
    `היי ${firstName(name)}, כאן המשך תנועה.`,
    open.length ? 'נשמח מאוד לעזרתך במפגשים האלה:' : 'תודה שהצטרפת לצוות המתנדבים שלנו!',
    ...lines,
    '',
    open.length ? 'בקישור האישי שלך אפשר לאשר הגעה, או לעדכן אם לא מסתדר:' : 'בקישור האישי שלך יופיעו המפגשים שנבקש בהם עזרה:',
    url,
    '',
    'תודה!',
  ].join('\n');
}

export function reminderMessage(name: string, s: Pick<Shift, 'role' | 'event'>): string {
  const e = s.event;
  const when = relativeDays(e.starts_at);
  return [
    `היי ${firstName(name)}, תזכורת קטנה לקראת ${e.title}${when === 'היום' || when === 'מחר' ? ` ${when}` : ''}, ${fmtDayLong(e.starts_at)}.`,
    `התפקיד: ${roleLabel(e.type, s.role)}`,
    `שעה: ${fmtTime(e.starts_at)}`,
    ...(e.location ? [`מקום: ${e.location}`] : []),
    '',
    'תודה על העזרה, נתראה שם!',
  ].join('\n');
}
