import type { Attendance, Engagement, EventStatus, EventType, Membership, PaymentMethod, PaymentStatus, RegStatus, Role, Settings } from './types';

/** The dismiss button of a dialog ("ביטול" means cancelling a registration or a meeting, so it is never the dismiss). */
export const DISMISS = 'חזרה';
/** A full-page form's way out without saving. */
export const DISMISS_UNSAVED = 'חזרה בלי שמירה';
/** Leaving a form with unsaved input (useUnsavedGuard, Dialog dismissible={false}). */
export const LEAVE_UNSAVED = {
  title: 'לצאת בלי לשמור?',
  body: 'מה שהוקלד כאן עוד לא נשמר, והוא לא יישמר.',
  confirm: 'יציאה בלי שמירה',
} as const;

export const ROLE_LABEL: Record<Role, string> = { admin: 'ניהול', coordinator: 'ריכוז', volunteer: 'צוות כניסה' };
export const ROLE_HINT: Record<Role, string> = {
  admin: 'הכול, כולל משתמשים, הגדרות, ייצוא ומחיקת פרטים',
  coordinator: 'מפגשים, לוחמים, מעקב, מרצים ודוחות',
  volunteer: 'רק רשימת הנוכחות של המפגש של היום',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = { friday: 'מפגש שישי', bonfire: 'ערב מדורה', other: 'מפגש אחר' };
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'טיוטה', open: 'הרשמה פתוחה', closed: 'הרשמה סגורה', completed: 'התקיים', cancelled: 'בוטל',
};
export const REG_STATUS_LABEL: Record<RegStatus, string> = { registered: 'הרשמה פעילה', waitlisted: 'רשימת המתנה', cancelled: 'ביטול', pending_payment: 'מחכה לתשלום' };
export const ATTENDANCE_LABEL: Record<Attendance, string> = { unknown: 'עוד לא סומנה הגעה', attended: 'הגעה', no_show: 'אי־הגעה' };

export const ENGAGEMENT_LABEL: Record<Engagement, string> = {
  registered: 'לפני הגעה ראשונה',
  first_timer: 'הגעה ראשונה',
  returning: 'הגעה חוזרת',
  regular: 'הגעה קבועה',
  lapsed: 'הגעה שנפסקה',
};
/** Short hints without the numbers (the thresholds are editable in the settings; engagementHint() names them). */
export const ENGAGEMENT_HINT: Record<Engagement, string> = {
  registered: 'יש הרשמה, אבל עוד אין הגעה לאף מפגש',
  first_timer: 'הגעה למפגש אחד',
  returning: 'הגעה ליותר ממפגש אחד',
  regular: 'הגעה קבועה למפגשי שישי בתקופה האחרונה (לפי ההגדרות)',
  lapsed: 'הגעה קבועה בעבר, ומאז כמה מפגשי שישי בלי הגעה (לפי ההגדרות)',
};
/** The hint with the thresholds from the settings ("הגעה ל־2 מפגשי שישי לפחות ב־30 הימים האחרונים"). */
export function engagementHint(e: Engagement, s?: Pick<Settings, 'regular_min_fridays' | 'regular_window_days' | 'lapsed_after_fridays'> | null): string {
  if (!s) return ENGAGEMENT_HINT[e];
  if (e === 'regular') return `הגעה ל־${s.regular_min_fridays} מפגשי שישי לפחות ב־${s.regular_window_days} הימים האחרונים`;
  if (e === 'lapsed') return `הגעה קבועה בעבר, ומאז ההגעה האחרונה התקיימו ${s.lapsed_after_fridays} מפגשי שישי בלי הגעה`;
  return ENGAGEMENT_HINT[e];
}

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

// ───────── shared wording (the glossary), for every screen ─────────

/** Registration counts and filter chips: plural verbs. */
export const COUNT_LABEL = {
  all: 'הכול',
  registered: 'רשומים',
  waitlisted: 'רשימת המתנה',
  attended: 'הגיעו',
  no_show: 'לא הגיעו',
  cancelled: 'ביטלו',
  unpaid: 'לא שילמו',
  walk_in: 'בלי הרשמה',
} as const;

/** Money: the order and words of the finance tiles everywhere (incoming first, then out, then the result). */
export const MONEY_LABEL = {
  collected: 'נגבה',
  /** the amount not yet paid (the registration status stays "מחכה לתשלום", REG_STATUS_LABEL) */
  pending: 'עוד לא שולם',
  expenses: 'הוצאות',
  net: 'נטו',
  forecast: 'צפי',
  confirm: 'אישור תשלום',
  paidOnSite: 'שולם במקום',
  suppliers: 'תשלומים לספקים',
  matchToRegistration: 'התאמה להרשמה',
} as const;

export const UNASSIGNED_LABEL = 'בלי אחראי';
export const SOURCE_LABEL = 'מקור הגעה';
export const ALL_MEETING_TYPES_LABEL = 'כל סוגי המפגשים';
export const NO_RESULTS_TITLE = 'אין תוצאות לחיפוש הזה';
export const CLEAR_SEARCH_LABEL = 'ניקוי החיפוש והסינון';

/**
 * One count line for a meeting: "24 רשומים · 2 בלי הרשמה · 26 מתוך 28". Registered = active registrations; walk-ins
 * come without one; free places = capacity − (registered + walk-ins). Parts that are zero or unknown are left out.
 */
export function meetingCountLine(registered: number, walkIns = 0, capacity?: number | null): string {
  const parts = [`${registered} ${COUNT_LABEL.registered}`];
  if (walkIns > 0) parts.push(`${walkIns} ${COUNT_LABEL.walk_in}`);
  if (capacity) parts.push(`${registered + walkIns} מתוך ${capacity}`);
  return parts.join(' · ');
}
/** Free places by the same rule: capacity − (registered + walk-ins), never below 0; null without a capacity. */
export function freePlaces(registered: number, walkIns = 0, capacity?: number | null): number | null {
  return capacity ? Math.max(0, capacity - registered - walkIns) : null;
}
