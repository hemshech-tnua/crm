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
/** "יום שישי, 14 בנובמבר" */
export const fmtDayLong = (v: string | Date) => `${fmtDay(v)}, ${fmtLongDate(v)}`;
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
  if (days > 1) return `בעוד ${days} ימים`;
  return `לפני ${-days} ימים`;
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
