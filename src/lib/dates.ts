// All dates are shown in Israel time, whatever the device's time zone.
export const TZ = 'Asia/Jerusalem';

const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long' });
const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric', year: '2-digit' });
const shortDateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric' });
const longDateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const monthFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, month: 'long', year: 'numeric' });
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

const d = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

export const fmtDay = (v: string | Date) => dayFmt.format(d(v));
export const fmtDate = (v: string | Date) => dateFmt.format(d(v));
export const fmtShortDate = (v: string | Date) => shortDateFmt.format(d(v));
export const fmtLongDate = (v: string | Date) => longDateFmt.format(d(v));
export const fmtTime = (v: string | Date) => timeFmt.format(d(v));
export const fmtMonth = (v: string | Date) => monthFmt.format(d(v));
const yearFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' });
const ddmmFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const weekdayIdxFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const WEEKDAY_IDX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Hebrew weekday letters with a geresh: א׳ … ש׳ */
const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/** Is the moment in the current year (Israel time)? Dates in the current year are shown without the year. */
export const isThisYear = (v: string | Date, now: Date = new Date()) => yearFmt.format(d(v)) === yearFmt.format(now);
/** "ו׳" — the weekday as one Hebrew letter. */
export const fmtWeekdayShort = (v: string | Date) => WEEKDAY_SHORT[WEEKDAY_IDX[weekdayIdxFmt.format(d(v))] ?? 0];

/**
 * The date in lists: "ו׳ 20.11 · 11:55"; "ו׳ 20.11.25 · 11:55" outside the current year.
 * `time: false` → "ו׳ 20.11". `weekday: false` → "20.11 · 11:55".
 */
export function fmtListDate(v: string | Date, opts: { time?: boolean; weekday?: boolean; now?: Date } = {}): string {
  const { time = true, weekday = true, now } = opts;
  const p = Object.fromEntries(ddmmFmt.formatToParts(d(v)).map((x) => [x.type, x.value]));
  const day = `${Number(p.day)}.${p.month}${isThisYear(v, now) ? '' : `.${String(p.year).slice(-2)}`}`;
  return [weekday ? `${fmtWeekdayShort(v)} ${day}` : day, time ? fmtTime(v) : null].filter(Boolean).join(' · ');
}

/** The date in page titles: "יום שישי, 20 בנובמבר"; with the year ("…, 20 בנובמבר 2025") outside the current year. */
export function fmtTitleDate(v: string | Date, now?: Date): string {
  return `${fmtDay(v)}, ${fmtLongDate(v)}${isThisYear(v, now) ? '' : ` ${yearFmt.format(d(v))}`}`;
}
/** "יום שישי, 14 בנובמבר" (the year only when it is not the current one). Same as fmtTitleDate. */
export const fmtDayLong = (v: string | Date) => fmtTitleDate(v);
export const fmtDateTime = (v: string | Date) => `${fmtDate(v)} ${fmtTime(v)}`;

/** Parts of a moment in Israel time. */
export function ilParts(v: string | Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d(v)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

/** Israel-time date ("2026-11-13") + time ("09:00") → ISO instant. Handles DST by probing the offset. */
export function fromIl(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  for (let i = 0; i < 3; i++) {
    const p = ilParts(guess);
    const shown = new Date(`${p.date}T${p.time}:00Z`).getTime();
    const want = new Date(`${date}T${time}:00Z`).getTime();
    if (shown === want) break;
    guess.setTime(guess.getTime() + (want - shown));
  }
  return guess.toISOString();
}

export function todayIl(): string {
  return ilParts(new Date()).date;
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** The next Friday (Israel time) on or after a date. */
export function nextFriday(from = todayIl()): string {
  const t = new Date(`${from}T12:00:00Z`);
  const diff = (5 - t.getUTCDay() + 7) % 7;
  return addDays(from, diff);
}

export function relativeDays(v: string | Date): string {
  const today = todayIl();
  const target = ilParts(v).date;
  const days = Math.round((new Date(`${target}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 864e5);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === -1) return 'אתמול';
  // non-breaking spaces: "בעוד 7 ימים" is read as one unit and never splits across lines
  if (days > 1) return `בעוד\u00a0${days}\u00a0ימים`;
  return `לפני\u00a0${-days}\u00a0ימים`;
}

export function age(birthYear?: number | null, birthDate?: string | null): number | null {
  const now = new Date();
  if (birthDate) {
    const b = new Date(birthDate);
    let a = now.getFullYear() - b.getFullYear();
    if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
    return a;
  }
  return birthYear ? now.getFullYear() - birthYear : null;
}
