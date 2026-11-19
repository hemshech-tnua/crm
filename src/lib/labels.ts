import type { Attendance, Engagement, EventStatus, EventType, Membership, PaymentMethod, PaymentStatus, RegStatus, Role } from './types';

export const ROLE_LABEL: Record<Role, string> = { admin: 'ניהול', coordinator: 'ריכוז', volunteer: 'צוות כניסה' };
export const ROLE_HINT: Record<Role, string> = {
  admin: 'הכול, כולל משתמשים, הגדרות, ייצוא ומחיקת פרטים',
  coordinator: 'מפגשים, משתתפים, מעקב, מרצים ודוחות',
  volunteer: 'רק רשימת הנוכחות של המפגש של היום',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = { friday: 'מפגש שישי', bonfire: 'ערב מדורה', other: 'פעילות אחרת' };
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'טיוטה', open: 'הרשמה פתוחה', closed: 'הרשמה סגורה', completed: 'התקיים', cancelled: 'בוטל',
};
export const REG_STATUS_LABEL: Record<RegStatus, string> = { registered: 'הרשמה פעילה', waitlisted: 'בהמתנה', cancelled: 'ביטול', pending_payment: 'ממתין לתשלום' };
export const ATTENDANCE_LABEL: Record<Attendance, string> = { unknown: 'טרם סומן', attended: 'הגעה', no_show: 'אי־הגעה' };

export const ENGAGEMENT_LABEL: Record<Engagement, string> = {
  registered: 'לפני הגעה ראשונה',
  first_timer: 'הגעה ראשונה',
  returning: 'הגעה חוזרת',
  regular: 'הגעה קבועה',
  lapsed: 'הגעה שנפסקה',
};
export const ENGAGEMENT_HINT: Record<Engagement, string> = {
  registered: 'יש הרשמה, אבל עוד אין הגעה לאף מפגש',
  first_timer: 'הגעה למפגש אחד',
  returning: 'הגעה ליותר ממפגש אחד',
  regular: 'הגעה ל-2 מפגשי שישי לפחות ב-30 הימים האחרונים',
  lapsed: 'הגעה קבועה בעבר, ומאז הביקור האחרון התקיימו 3 מפגשי שישי בלי הגעה',
};

export const FOLLOWUP_TYPE_LABEL = {
  no_show: 'הרשמה בלי הגעה',
  first_time: 'פעם ראשונה',
  lapsed: 'הגעה שנפסקה',
  waitlist: 'רשימת המתנה',
  general: 'כללי',
  membership: 'הצטרפות לעמותה',
  payment: 'תשלום',
} as const;

export const MEMBERSHIP_LABEL: Record<Membership, string> = { none: 'בלי חברות בעמותה', requested: 'בקשת הצטרפות לעמותה', member: 'חברות בעמותה' };

export const CHANNEL_LABEL = { whatsapp: 'וואטסאפ', phone: 'שיחת טלפון', in_person: 'פנים אל פנים', other: 'אחר' } as const;

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  none: 'לא נדרש תשלום', pending: 'לא שולם', paid: 'שולם', waived: 'פטור מתשלום', refunded: 'הוחזר',
};
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'כרטיס אשראי', bit: 'Bit', paybox: 'PayBox', cash: 'מזומן', transfer: 'העברה בנקאית', other: 'אחר',
};

/**
 * Follow-up task titles as shown on screen. Tasks the database opens automatically still carry the older slashed
 * wording in their stored title ("נרשם/ה ולא הגיע/ה: …"); show them in the current gender-neutral wording, which also
 * matches FOLLOWUP_TYPE_LABEL, so the type badge is hidden as it is for new titles. Stored data is left unchanged.
 */
const LEGACY_TASK_TITLES: [string, string][] = [
  ['נרשם/ה ולא הגיע/ה:', 'הרשמה בלי הגעה:'],
  ['קבוע/ה שהפסיק/ה להגיע: לשאול מה שלומו/ה', 'הגעה קבועה שנפסקה: לשאול מה נשמע'],
  ['הגיע/ה בפעם הראשונה:', 'פעם ראשונה:'],
  ['ביקש/ה להצטרף לעמותה:', 'הצטרפות לעמותה:'],
];
export function taskTitle(title: string): string {
  for (const [old, now] of LEGACY_TASK_TITLES) if (title.startsWith(old)) return now + title.slice(old.length);
  return title;
}

/** The same for outcomes the database writes when it closes a task by itself ("נסגר אוטומטית: …"). */
const LEGACY_OUTCOMES: [string, string][] = [
  ['נסגר אוטומטית: סומן/ה כמי שהגיע/ה', 'נסגר אוטומטית: סומנה הגעה'],
  ['נסגר אוטומטית: סומן/ה כחבר/ת עמותה', 'נסגר אוטומטית: סומנה חברות בעמותה'],
  ['נסגר אוטומטית: הגיע/ה ל', 'נסגר אוטומטית: הגעה ל'],
];
export function taskOutcome(outcome: string): string {
  for (const [old, now] of LEGACY_OUTCOMES) if (outcome.startsWith(old)) return now + outcome.slice(old.length);
  return outcome;
}
