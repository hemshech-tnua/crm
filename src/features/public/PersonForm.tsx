// The registration questions (questionnaire Q13), shared by the registration page and the walk-in form at the door.
// Client checks mirror private.parse_person() for quick feedback; the server re-checks everything.
import { useId, useMemo, useState } from 'react';
import { errorCode, errorMessage } from '@/lib/errors';
import { normalizePhone } from '@/lib/phone';
import { Checkbox, ChoiceGroup, Input } from '@/ui/kit';
import type { PersonPayload, PublicSource } from './api';
import { Honeypot, PrivacyNote } from './shared';

export type PersonValues = {
  full_name: string;
  phone: string;
  city: string;
  age: string;
  source: string;
  source_detail: string;
  referrer: string;
  consent_updates: boolean;
  photo_opt_out: boolean;
  website: string;
};

type CheckedField = 'full_name' | 'phone' | 'city' | 'age' | 'source';
export type PersonErrors = Partial<Record<CheckedField, string>>;
const ORDER: CheckedField[] = ['full_name', 'phone', 'city', 'age', 'source'];

const EMPTY: PersonValues = {
  full_name: '', phone: '', city: '', age: '', source: '', source_detail: '', referrer: '',
  consent_updates: false, photo_opt_out: false, website: '',
};

const FIELD_OF_CODE: Record<string, CheckedField> = {
  invalid_name: 'full_name', invalid_phone: 'phone', invalid_city: 'city', invalid_age: 'age', invalid_source: 'source',
};

const msg = (code: string) => errorMessage({ message: code });

/** Same cleanup as private.clean_text(): strip control characters, collapse spaces, trim. */
export function cleanText(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim();
}

const BAD_CHARS = /[0-9<>@/\\{}=;]/;

export function nameError(raw: string): string | undefined {
  const v = cleanText(raw);
  if (!v) return 'צריך לכתוב שם מלא.';
  if (v.length < 2 || BAD_CHARS.test(v) || /https?:|www\./i.test(v)) return msg('invalid_name');
}

export function phoneError(raw: string): string | undefined {
  if (!raw.trim()) return 'צריך לכתוב מספר טלפון.';
  if (!normalizePhone(raw)) return msg('invalid_phone');
}

export function validatePerson(v: PersonValues): PersonErrors {
  const e: PersonErrors = {};
  e.full_name = nameError(v.full_name);
  e.phone = phoneError(v.phone);
  const city = cleanText(v.city);
  if (city.length < 2 || BAD_CHARS.test(city)) e.city = msg('invalid_city');
  const age = v.age.trim();
  if (!age) e.age = 'צריך לכתוב גיל.';
  else if (!/^\d{1,3}$/.test(age) || Number(age) < 16 || Number(age) > 99) e.age = msg('invalid_age');
  if (!v.source) e.source = msg('invalid_source');
  for (const k of ORDER) if (!e[k]) delete e[k];
  return e;
}

export function usePersonForm(initial: Partial<PersonValues> = {}) {
  const prefix = useId();
  const [values, setValues] = useState<PersonValues>(() => ({ ...EMPTY, ...initial }));
  const [errors, setErrors] = useState<PersonErrors>({});
  const ids = useMemo(
    () => Object.fromEntries(ORDER.map((k) => [k, `${prefix}-${k}`])) as Record<CheckedField, string>,
    [prefix],
  );

  const set = <K extends keyof PersonValues>(key: K, value: PersonValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  };

  const focusFirst = (errs: PersonErrors) => {
    const first = ORDER.find((k) => errs[k]);
    if (!first) return;
    const el = document.getElementById(ids[first]);
    const target = el && (el.matches('input, textarea, select') ? el : el.querySelector<HTMLElement>('input'));
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
  };

  /** Client-side check before sending. Returns true when the form can be sent. */
  const check = (): boolean => {
    const errs = validatePerson(values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return false;
    }
    return true;
  };

  /** A field-level error from the server (invalid_phone…) goes next to its field. Returns false for other errors. */
  const serverError = (err: unknown): boolean => {
    const field = FIELD_OF_CODE[errorCode(err)];
    if (!field) return false;
    const errs = { [field]: errorMessage(err) };
    setErrors(errs);
    focusFirst(errs);
    return true;
  };

  const payload = (sources: PublicSource[]): PersonPayload => {
    const src = sources.find((s) => s.key === values.source);
    const detail = cleanText(values.source_detail);
    const referrer = cleanText(values.referrer);
    return {
      full_name: cleanText(values.full_name),
      phone: normalizePhone(values.phone) ?? values.phone.trim(),
      city: cleanText(values.city),
      age: values.age.trim(),
      source: values.source,
      source_detail: src?.asks_detail && detail ? detail : undefined,
      referrer: src?.is_friend && referrer ? referrer : undefined,
      consent_updates: values.consent_updates,
      photo_opt_out: values.photo_opt_out,
      website: values.website,
    };
  };

  return { values, set, errors, ids, check, serverError, payload };
}

export type PersonForm = ReturnType<typeof usePersonForm>;

/** Name, phone, city, age and "how did you hear about us" (+ who brought you / details). */
export function PersonFields({ form, sources, invitedBy, big = false }: {
  form: PersonForm;
  sources: PublicSource[];
  /** the first name of whoever sent a personal invite link: then we do not ask who brought you */
  invitedBy?: string | null;
  /** larger fields for the door (sunlight, one hand) */
  big?: boolean;
}) {
  const { values: v, set, errors, ids } = form;
  const src = sources.find((s) => s.key === v.source);
  const size = big ? 'h-14! text-lg' : '';
  return (
    <>
      <Input
        id={ids.full_name}
        label="שם מלא"
        required
        autoComplete="name"
        maxLength={80}
        enterKeyHint="next"
        className={size}
        value={v.full_name}
        onChange={(e) => set('full_name', e.target.value)}
        error={errors.full_name}
      />
      <Input
        id={ids.phone}
        label="טלפון נייד"
        required
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="next"
        ltr
        maxLength={20}
        placeholder="050-1234567"
        className={size}
        value={v.phone}
        onChange={(e) => set('phone', e.target.value)}
        error={errors.phone}
      />
      <Input
        id={ids.city}
        label="עיר מגורים"
        required
        autoComplete="address-level2"
        maxLength={60}
        enterKeyHint="next"
        className={size}
        value={v.city}
        onChange={(e) => set('city', e.target.value)}
        error={errors.city}
      />
      <Input
        id={ids.age}
        label="גיל"
        required
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={2}
        enterKeyHint="next"
        className={`max-w-32 ${size}`}
        value={v.age}
        onChange={(e) => set('age', e.target.value.replace(/[^\d]/g, ''))}
        error={errors.age}
      />
      <div id={ids.source}>
        <ChoiceGroup
          legend="איך שמעת עלינו?"
          required
          columns={2}
          options={sources.map((s) => ({ value: s.key, label: s.label }))}
          value={v.source}
          onChange={(k) => set('source', k)}
          error={errors.source}
        />
      </div>
      {src?.is_friend && (invitedBy ? (
        <p className="-mt-2 text-sm text-muted">רשמנו שהגעת בהזמנה של {invitedBy}.</p>
      ) : (
        <Input
          label="מי הביא/ה אותך? שם או טלפון"
          hint="לא חובה. כך נדע להגיד תודה."
          maxLength={80}
          autoComplete="off"
          value={v.referrer}
          onChange={(e) => set('referrer', e.target.value)}
        />
      ))}
      {src?.asks_detail && (
        <Input
          label="רוצה לפרט?"
          hint="לא חובה."
          maxLength={120}
          autoComplete="off"
          value={v.source_detail}
          onChange={(e) => set('source_detail', e.target.value)}
        />
      )}
    </>
  );
}

/** The two separate, optional choices (never pre-checked) + the privacy notice + the spam trap. */
export function ConsentFields({ form }: { form: PersonForm }) {
  const { values: v, set } = form;
  return (
    <>
      <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
        <legend className="sr-only">העדפות (לא חובה)</legend>
        <Checkbox
          label="אשמח לקבל עדכונים והזמנות למפגשים בוואטסאפ"
          hint="לא חובה. אפשר להפסיק בכל רגע בתשובה ״הסר״."
          checked={v.consent_updates}
          onChange={(c) => set('consent_updates', c)}
        />
        <Checkbox
          label="אני מעדיף/ה לא להופיע בתמונות מהמפגשים"
          hint="במפגשים מצלמים לפעמים לעמודים של העמותה. הצוות יראה את הבקשה שלך."
          checked={v.photo_opt_out}
          onChange={(c) => set('photo_opt_out', c)}
        />
      </fieldset>
      <PrivacyNote />
      <Honeypot value={v.website} onChange={(w) => set('website', w)} />
    </>
  );
}
