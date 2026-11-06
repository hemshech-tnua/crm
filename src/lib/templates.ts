import { fmtDayLong, fmtTime } from './dates';

export type TemplateContext = {
  firstName?: string | null;
  eventTitle?: string | null;
  startsAt?: string | null;
  location?: string | null;
  activity?: string | null;
  speaker?: string | null;
  topic?: string | null;
  registerLink?: string | null;
  feedbackLink?: string | null;
};

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'שם_פרטי', label: 'השם הפרטי של הלוחם/ת' },
  { key: 'שם_המפגש', label: 'כותרת המפגש' },
  { key: 'תאריך', label: 'יום ותאריך' },
  { key: 'שעה', label: 'שעת התחלה' },
  { key: 'מקום', label: 'מקום' },
  { key: 'פעילות', label: 'יוגה / פילאטיס' },
  { key: 'מרצה', label: 'שם המרצה' },
  { key: 'נושא', label: 'נושא ההרצאה' },
  { key: 'קישור_הרשמה', label: 'קישור להרשמה למפגש' },
  { key: 'קישור_משוב', label: 'קישור למשוב על המפגש' },
];

/** Fills {placeholders}. Lines whose placeholders have no value are dropped instead of sending "הרצאה של {מרצה}". */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const values: Record<string, string | null | undefined> = {
    'שם_פרטי': ctx.firstName,
    'שם_המפגש': ctx.eventTitle,
    'תאריך': ctx.startsAt ? fmtDayLong(ctx.startsAt) : null,
    'שעה': ctx.startsAt ? fmtTime(ctx.startsAt) : null,
    'מקום': ctx.location,
    'פעילות': ctx.activity,
    'מרצה': ctx.speaker,
    'נושא': ctx.topic,
    'קישור_הרשמה': ctx.registerLink,
    'קישור_משוב': ctx.feedbackLink,
  };
  return body
    .split('\n')
    .map((line) => {
      let missing = false;
      const out = line.replace(/\{([^{}\s]+)\}/g, (m, key: string) => {
        if (!(key in values)) return m;
        const v = values[key];
        if (v == null || v === '') {
          missing = true;
          return '';
        }
        return v;
      });
      return missing ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join('\n')
    .trim();
}

export function unknownPlaceholders(body: string): string[] {
  const known = new Set(PLACEHOLDERS.map((p) => p.key));
  return [...body.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).filter((k) => !known.has(k));
}
