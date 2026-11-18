// Plain-text pieces describing an event, shared by the ticket, the calendar file and the invite message.
import type { PublicEvent } from '@/lib/types';
import { fmtDayLong, fmtTime } from '@/lib/dates';

export function activityText(e: PublicEvent): string | null {
  if (e.activity_name && e.instructor_name) return `${e.activity_name} עם ${e.instructor_name}`;
  return e.activity_name ?? (e.instructor_name ? `פעילות עם ${e.instructor_name}` : null);
}

export function lectureText(e: PublicEvent): string | null {
  if (e.speaker_name && e.lecture_topic) return `${e.speaker_name}: ${e.lecture_topic}`;
  if (e.speaker_name) return `הרצאה של ${e.speaker_name}`;
  return e.lecture_topic ? `הרצאה: ${e.lecture_topic}` : null;
}

export const timeRange = (e: PublicEvent) => `${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`;

export const whenText = (e: PublicEvent) => `${fmtDayLong(e.starts_at)}, ${timeRange(e)}`;

/** "היוגה", "הפילאטיס": the activity with the Hebrew definite article, for questions like "מה דעתך על היוגה?". */
export function theActivity(e: PublicEvent): string {
  const name = e.activity_name?.trim();
  if (!name) return 'הפעילות';
  return /^[א-ת]/.test(name) ? `ה${name}` : name;
}

/**
 * Display text with the association's name kept on one line: "המשך תנועה" (quoted or not) never breaks between its two
 * words, so a title or description does not leave "המשך" at the end of one line and "תנועה" on the next. Display only:
 * messages and calendar files keep the plain text.
 */
export const keepName = (text: string): string => text.replace(/המשך תנועה/g, 'המשך\u00a0תנועה');
