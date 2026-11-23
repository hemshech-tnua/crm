// Server error codes → Hebrew messages. The server raises short codes; the UI never shows raw database text.
// These messages appear on staff AND public screens, so they are address-neutral: no "you", no imperative ("אפשר…",
// "צריך…", "כדאי…").
import { PHONE_EXAMPLE } from './phone';

/** The message for an error without a known code. */
export const FALLBACK_ERROR = 'משהו השתבש. אפשר לנסות שוב. אם זה חוזר, כדאי לפנות לצוות העמותה.';
const MESSAGES: Record<string, string> = {
  invalid_name: 'צריך שם פרטי ושם משפחה, באותיות בלבד.',
  invalid_phone: `צריך מספר טלפון נייד, למשל ${PHONE_EXAMPLE}.`,
  invalid_city: 'צריך לכתוב את שם העיר (לפחות 2 אותיות, בלי ספרות).',
  invalid_age: 'צריך לכתוב גיל בין 16 ל־99.',
  invalid_source: 'צריך לבחור איך שמעתם עלינו.',
  invalid_topic: 'צריך לכתוב נושא (לפחות 2 אותיות).',
  invalid_url: 'הקישור צריך להתחיל ב־https://',
  invalid_kind: 'צריך לבחור אחת מהאפשרויות.',
  invalid_rating: 'צריך לבחור ציון מ־1 עד 5.',
  invalid_date: 'צריך לבחור תאריך תקין.',
  invalid_attendance: 'צריך לבחור סטטוס הגעה.',
  event_not_found: 'לא מצאנו את המפגש. ייתכן שהקישור ישן.',
  event_cancelled: 'המפגש הזה בוטל.',
  registration_closed: 'ההרשמה למפגש הזה נסגרה.',
  registration_not_open: 'ההרשמה למפגש הזה עוד לא נפתחה. אפשר לנסות שוב בקרוב.',
  event_full: 'כל המקומות במפגש נתפסו.',
  rate_limited: 'יותר מדי ניסיונות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות.',
  token_invalid: 'הקישור האישי לא תקין או שפג תוקפו. כדאי לבדוק שהקישור הועתק במלואו.',
  too_late: 'אי אפשר לבטל אחרי שהמפגש התחיל.',
  checkin_not_found: 'קוד הכניסה לא תקין. אפשר לסרוק שוב את הברקוד או לגשת לצוות בכניסה.',
  feedback_not_open: 'אפשר לתת משוב מרגע שהמפגש מתחיל.',
  feedback_closed: 'תקופת המשוב למפגש הזה הסתיימה.',
  forbidden: 'אין לך הרשאה לפעולה הזו.',
  only_admin_approves: 'רק בעלי הרשאת ניהול יכולים לאשר מרצים ומדריכים.',
  not_found: 'לא מצאנו את זה. ייתכן שזה נמחק.',
  not_started: 'אפשר לסגור מפגש רק אחרי שהתחיל.',
  event_not_active: 'המפגש עוד בטיוטה או שבוטל.',
  already_registered: 'כבר יש הרשמה למפגש הזה מהמספר הזה.',
  not_waitlisted: 'ההרשמה כבר לא ברשימת ההמתנה.',
  same_participant: 'אי אפשר למזג כרטיס עם עצמו.',
  invalid_email: 'כתובת האימייל לא תקינה.',
  invalid_role: 'תפקיד לא תקין. צריך לבחור תפקיד מהרשימה.',
  pwned_password: 'הסיסמה הזו מופיעה ברשימות של סיסמאות שדלפו ברשת. צריך לבחור סיסמה אחרת.',
  mfa_required: 'צריך לאשר את הכניסה בקוד מאפליקציית האימות.',
  mfa_invalid: 'הקוד לא נכון או שפג תוקפו. אפשר להקליד את הקוד הנוכחי מהאפליקציה.',
  email_exists: 'כבר יש משתמש עם האימייל הזה.',
  invite_invalid: 'הקישור לא תקף: כבר השתמשו בו, או שעברו 48 שעות. אפשר לבקש קישור חדש ממנהלי המערכת.',
  claim_failed: 'אי אפשר לשמור את האימייל הזה. אפשר לנסות כתובת אחרת או לפנות למנהלי המערכת.',
  phone_exists: 'כבר יש משתמש עם מספר הטלפון הזה.',
  login_required: 'צריך טלפון נייד (לכניסה בקוד SMS) או אימייל (לכניסה בסיסמה).',
  no_email: 'למשתמש הזה אין אימייל ואין טלפון.',
  invalid_login: 'הטלפון או הסיסמה לא נכונים.',
  weak_password: 'הסיסמה צריכה לכלול לפחות 10 תווים, אותיות וספרות.',
  cannot_change_self: 'אי אפשר לשנות את התפקיד או לחסום את המשתמש שלך.',
  last_admin: 'חייב להישאר לפחות חשבון ניהול פעיל אחד.',
  unauthenticated: 'עבר הרבה זמן מאז הכניסה. צריך להיכנס שוב.',
  duplicate_phone: 'כבר יש כרטיס עם מספר הטלפון הזה.',
  duplicate: 'הפריט הזה כבר קיים.',
  network: 'אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.',
  invalid_payment_status: 'סטטוס תשלום לא תקין. צריך לבחור סטטוס מהרשימה.',
  invalid_payment_method: 'אמצעי תשלום לא תקין. צריך לבחור אמצעי תשלום מהרשימה.',
  invalid_amount: 'צריך סכום חיובי, למשל 20.',
  not_paid: 'אפשר לסמן החזר רק אחרי שסומן תשלום.',
  not_priced: 'במפגש הזה אין דמי השתתפות.',
  payment_not_pending: 'התשלום הזה כבר לא מחכה לאישור. אפשר לעדכן אותו בעמוד המפגש.',
};

export type AppError = { message?: string; code?: string; details?: string | null; status?: number } | null | undefined;

export function errorCode(err: unknown): string {
  const e = err as AppError;
  if (!e) return 'unknown';
  if (e.code === '23505') return /phone/.test(`${e.message ?? ''} ${e.details ?? ''}`) ? 'duplicate_phone' : 'duplicate';
  if (e.code === '42501' && !e.message?.match(/^[a-z_]+$/)) return 'forbidden';
  if (e.message && /^[a-z_]+$/.test(e.message)) return e.message;
  if (e.message && /fetch|network|Failed to fetch|NetworkError/i.test(e.message)) return 'network';
  // a data request that timed out (db.timeout in supabase.ts) or was cut off: "AbortError: signal is aborted without reason"
  if (e.message && /AbortError|TimeoutError|signal is aborted/i.test(e.message)) return 'network';
  return 'unknown';
}

export function errorMessage(err: unknown): string {
  return MESSAGES[errorCode(err)] ?? FALLBACK_ERROR;
}

/** Throws the Supabase error so React Query surfaces it. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}
