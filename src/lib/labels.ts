import type { Attendance, Engagement, EventStatus, EventType, RegStatus, Role } from './types';

export const ROLE_LABEL: Record<Role, string> = { admin: 'מנהל/ת', coordinator: 'רכז/ת', volunteer: 'צוות כניסה' };
export const ROLE_HINT: Record<Role, string> = {
  admin: 'הכול, כולל משתמשים, הגדרות, ייצוא ומחיקת פרטים',
  coordinator: 'מפגשים, משתתפים, מעקב, מרצים ודוחות',
  volunteer: 'רק רשימת הנוכחות של המפגש של היום',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = { friday: 'מפגש שישי', bonfire: 'ערב מדורה', other: 'פעילות אחרת' };
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'טיוטה', open: 'הרשמה פתוחה', closed: 'הרשמה סגורה', completed: 'התקיים', cancelled: 'בוטל',
};
export const REG_STATUS_LABEL: Record<RegStatus, string> = { registered: 'רשום/ה', waitlisted: 'בהמתנה', cancelled: 'ביטל/ה' };
export const ATTENDANCE_LABEL: Record<Attendance, string> = { unknown: 'טרם סומן', attended: 'הגיע/ה', no_show: 'לא הגיע/ה' };

export const ENGAGEMENT_LABEL: Record<Engagement, string> = {
  registered: 'טרם הגיע/ה',
  first_timer: 'חדש/ה',
  returning: 'חוזר/ת',
  regular: 'קבוע/ה',
  lapsed: 'הפסיק/ה להגיע',
};
export const ENGAGEMENT_HINT: Record<Engagement, string> = {
  registered: 'נרשם/ה אבל עוד לא הגיע/ה לאף מפגש',
  first_timer: 'הגיע/ה למפגש אחד',
  returning: 'הגיע/ה ליותר ממפגש אחד',
  regular: 'הגיע/ה לפחות ל-2 מפגשי שישי ב-30 הימים האחרונים',
  lapsed: 'היה/תה קבוע/ה, ומאז הביקור האחרון התקיימו 3 מפגשי שישי בלי שהגיע/ה',
};

export const FOLLOWUP_TYPE_LABEL = {
  no_show: 'נרשם/ה ולא הגיע/ה',
  first_time: 'פעם ראשונה',
  lapsed: 'הפסיק/ה להגיע',
  waitlist: 'רשימת המתנה',
  general: 'כללי',
} as const;

export const CHANNEL_LABEL = { whatsapp: 'וואטסאפ', phone: 'שיחת טלפון', in_person: 'פנים אל פנים', other: 'אחר' } as const;
