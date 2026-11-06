// "Add to calendar": an .ics file built in the browser (times in UTC, so every calendar app shows the right
// local time) and a Google Calendar link. No personal data goes into either: only the public event details.
import type { PublicEvent } from '@/lib/types';
import { ilParts } from '@/lib/dates';
import { registerUrl } from '@/lib/links';
import { activityText, lectureText } from './eventText';

/** 2026-11-13T07:00:00.000Z → 20261113T070000Z */
export function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded; never split a multi-byte character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function eventDetails(e: PublicEvent): string {
  return [activityText(e), lectureText(e), e.description].filter(Boolean).join('\n');
}

export function buildIcs(e: PublicEvent): string {
  const link = registerUrl(e.code);
  const description = [eventDetails(e), `פרטי המפגש: ${link}`].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hemshech Tnua//Events//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.code}@hemshech-tnua`,
    `DTSTAMP:${icsUtc(new Date().toISOString())}`,
    `DTSTART:${icsUtc(e.starts_at)}`,
    `DTEND:${icsUtc(e.ends_at)}`,
    `SUMMARY:${escapeText(`${e.title} · המשך תנועה`)}`,
    e.location ? `LOCATION:${escapeText(e.location)}` : '',
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${link}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(e: PublicEvent) {
  const blob = new Blob([buildIcs(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hemshech-tnua-${ilParts(e.starts_at).date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function googleCalendarUrl(e: PublicEvent): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${e.title} · המשך תנועה`,
    dates: `${icsUtc(e.starts_at)}/${icsUtc(e.ends_at)}`,
    details: [eventDetails(e), registerUrl(e.code)].filter(Boolean).join('\n\n'),
    location: e.location ?? '',
    ctz: 'Asia/Jerusalem',
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
