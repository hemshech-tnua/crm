// Server error codes → Hebrew messages. The server raises short codes; the UI never shows raw database text.
const MESSAGES: Record<string, string> = {
  invalid_name: 'צריך לכתוב שם מלא (אותיות בלבד).',
  invalid_phone: 'מספר הטלפון לא נראה תקין. כותבים כמו 050-1234567.',
  invalid_city: 'צריך לכתוב עיר מגורים.',
  invalid_age: 'צריך לכתוב גיל בין 16 ל-99.',
  invalid_source: 'צריך לבחור איך שמעת עלינו.',
  invalid_topic: 'צריך לכתוב נושא.',
  invalid_url: 'הקישור צריך להתחיל ב-https://',
  invalid_kind: 'בחירה לא תקינה.',
  invalid_rating: 'בחרו דירוג בין 1 ל-5.',
  invalid_date: 'התאריך לא תקין.',
  invalid_attendance: 'סטטוס נוכחות לא תקין.',
  event_not_found: 'לא מצאנו את המפגש. ייתכן שהקישור ישן.',
  event_cancelled: 'המפגש בוטל.',
  registration_closed: 'ההרשמה למפגש הזה נסגרה.',
  event_full: 'אין יותר מקומות במפגש.',
  rate_limited: 'יותר מדי ניסיונות בזמן קצר. נסו שוב בעוד כמה דקות.',
  token_invalid: 'הקישור האישי לא תקין או שפג תוקפו.',
  too_late: 'אי אפשר לבטל אחרי שהמפגש התחיל.',
  checkin_not_found: 'קוד הכניסה לא תקין. סרקו שוב את הברקוד שבכניסה.',
  feedback_not_open: 'אפשר לתת משוב רק אחרי שהמפגש מתחיל.',
  feedback_closed: 'תקופת המשוב למפגש הזה הסתיימה.',
  forbidden: 'אין לך הרשאה לפעולה הזו.',
  only_admin_approves: 'רק מנהל/ת יכול/ה לאשר מרצה.',
  not_found: 'הרשומה לא נמצאה. ייתכן שנמחקה.',
  not_started: 'אפשר לסגור מפגש רק אחרי שהתחיל.',
  event_not_active: 'המפגש לא פעיל (טיוטה או מבוטל).',
  already_registered: 'כבר רשום/ה למפגש הזה.',
  not_waitlisted: 'הרישום כבר לא ברשימת ההמתנה.',
  same_participant: 'אי אפשר למזג כרטיס עם עצמו.',
  invalid_email: 'כתובת האימייל לא תקינה.',
  invalid_role: 'תפקיד לא תקין.',
  email_exists: 'כבר יש משתמש עם האימייל הזה.',
  weak_password: 'הסיסמה צריכה לכלול לפחות 10 תווים, אותיות וספרות.',
  cannot_change_self: 'אי אפשר לשנות את התפקיד או לחסום את המשתמש שלך.',
  last_admin: 'חייב להישאר לפחות מנהל/ת פעיל/ה אחד/ת.',
  unauthenticated: 'פג תוקף ההתחברות. צריך להתחבר שוב.',
  duplicate_phone: 'כבר יש כרטיס עם מספר הטלפון הזה.',
  duplicate: 'הרשומה הזו כבר קיימת.',
  network: 'אין חיבור לשרת. בודקים את האינטרנט ומנסים שוב.',
};

export type AppError = { message?: string; code?: string; details?: string | null; status?: number } | null | undefined;

export function errorCode(err: unknown): string {
  const e = err as AppError;
  if (!e) return 'unknown';
  if (e.code === '23505') return /phone/.test(`${e.message ?? ''} ${e.details ?? ''}`) ? 'duplicate_phone' : 'duplicate';
  if (e.code === '42501' && !e.message?.match(/^[a-z_]+$/)) return 'forbidden';
  if (e.message && /^[a-z_]+$/.test(e.message)) return e.message;
  if (e.message && /fetch|network|Failed to fetch|NetworkError/i.test(e.message)) return 'network';
  return 'unknown';
}

export function errorMessage(err: unknown): string {
  return MESSAGES[errorCode(err)] ?? 'משהו השתבש. נסו שוב, ואם זה חוזר, פנו למנהל/ת המערכת.';
}

/** Throws the Supabase error so React Query surfaces it. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}
