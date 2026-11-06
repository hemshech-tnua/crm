import { useId, useState, type FormEvent } from 'react';
import { errorCode, errorMessage } from '@/lib/errors';
import { normalizePhone } from '@/lib/phone';
import { Button, ButtonLink, ChoiceGroup, ErrorBox, Input, Textarea } from '@/ui/kit';
import { propose } from './api';
import { cleanText, nameError, phoneError } from './PersonForm';
import { Honeypot, PrivacyNote, ResultTitle, SuccessMark } from './shared';

type Kind = 'speaker' | 'instructor';
type Values = { kind: Kind | ''; full_name: string; phone: string; topic: string; bio_line: string; social_url: string; message: string; website: string };
type Errors = Partial<Record<'kind' | 'full_name' | 'phone' | 'topic' | 'social_url', string>>;
const ORDER: (keyof Errors)[] = ['kind', 'full_name', 'phone', 'topic', 'social_url'];
const FIELD_OF_CODE: Record<string, keyof Errors> = {
  invalid_kind: 'kind', invalid_name: 'full_name', invalid_phone: 'phone', invalid_topic: 'topic', invalid_url: 'social_url',
};

/** "instagram.com/x" → "https://instagram.com/x"; an explicit http:// is left for the check to reject. */
function withScheme(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`;
}

function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.kind) e.kind = 'בחרו אם זו הרצאה או הדרכה.';
  e.full_name = nameError(v.full_name);
  e.phone = phoneError(v.phone);
  if (cleanText(v.topic).length < 2) e.topic = errorMessage({ message: 'invalid_topic' });
  const url = withScheme(v.social_url);
  if (url && !/^https:\/\/[^\s<>"]+\.[^\s<>"]+$/i.test(url)) e.social_url = errorMessage({ message: 'invalid_url' });
  for (const k of ORDER) if (!e[k]) delete e[k];
  return e;
}

export function ProposePage() {
  const ids = useId();
  const [v, setV] = useState<Values>({ kind: '', full_name: '', phone: '', topic: '', bio_line: '', social_url: '', message: '', website: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setV((x) => ({ ...x, [k]: val }));
    setErrors((x) => (k in x ? { ...x, [k]: undefined } : x));
  };

  const focusFirst = (errs: Errors) => {
    const first = ORDER.find((k) => errs[k]);
    if (!first) return;
    const el = document.getElementById(`${ids}-${first}`);
    const target = el && (el.matches('input, textarea') ? el : el.querySelector<HTMLElement>('input'));
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const errs = validate(v);
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirst(errs);
    setBusy(true);
    try {
      await propose({
        kind: v.kind as Kind,
        full_name: cleanText(v.full_name),
        phone: normalizePhone(v.phone) ?? v.phone.trim(),
        topic: cleanText(v.topic),
        bio_line: cleanText(v.bio_line) || undefined,
        social_url: withScheme(v.social_url) || undefined,
        message: v.message.trim() || undefined,
        website: v.website,
      });
      setDone(true);
    } catch (err) {
      setBusy(false);
      const field = FIELD_OF_CODE[errorCode(err)];
      if (field) {
        const fe = { [field]: errorMessage(err) };
        setErrors(fe);
        return focusFirst(fe);
      }
      setError(errorMessage(err));
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <SuccessMark />
        <ResultTitle className="mt-2">תודה! קיבלנו את ההצעה</ResultTitle>
        <p className="max-w-sm text-lg text-ink-soft">צוות העמותה יעבור עליה ויחזור אליך בטלפון.</p>
        <ButtonLink to="/" variant="secondary" className="mt-3">למפגשים הקרובים</ButtonLink>
      </div>
    );
  }

  const instructor = v.kind === 'instructor';
  return (
    <div>
      <h1 className="font-display text-[1.9rem] leading-tight">רוצים להרצות או להדריך?</h1>
      <p className="mt-1.5 text-[1.05rem] text-ink-soft">
        בכל מפגש שישי יש פעילות תנועה והרצאת אורח. אם יש לך משהו לתת לחבר׳ה שחוזרים מהמילואים, נשמח להכיר.
      </p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5" aria-label="הצעה להרצות או להדריך">
        <div id={`${ids}-kind`}>
          <ChoiceGroup<Kind>
            legend="מה תרצה/י להציע?"
            required
            columns={2}
            options={[
              { value: 'speaker', label: 'הרצאה' },
              { value: 'instructor', label: 'הדרכת פעילות (יוגה, פילאטיס, תנועה)' },
            ]}
            value={v.kind}
            onChange={(k) => set('kind', k)}
            error={errors.kind}
          />
        </div>
        <Input id={`${ids}-full_name`} label="שם מלא" required autoComplete="name" maxLength={80} value={v.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} />
        <Input
          id={`${ids}-phone`}
          label="טלפון"
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          ltr
          maxLength={20}
          placeholder="050-1234567"
          value={v.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={errors.phone}
        />
        <Input
          id={`${ids}-topic`}
          label={instructor ? 'איזו פעילות?' : 'נושא ההרצאה'}
          hint={instructor ? 'למשל: יוגה, פילאטיס, נשימות.' : 'במשפט אחד.'}
          required
          maxLength={160}
          value={v.topic}
          onChange={(e) => set('topic', e.target.value)}
          error={errors.topic}
        />
        <Input
          label="משפט אחד עליך"
          hint="לא חובה. כך נציג אותך למשתתפים."
          maxLength={240}
          value={v.bio_line}
          onChange={(e) => set('bio_line', e.target.value)}
        />
        <Input
          id={`${ids}-social_url`}
          label="קישור לאתר או לעמוד ברשת"
          hint="לא חובה."
          type="url"
          inputMode="url"
          autoComplete="url"
          ltr
          maxLength={300}
          placeholder="https://"
          value={v.social_url}
          onChange={(e) => set('social_url', e.target.value)}
          error={errors.social_url}
        />
        <Textarea
          label="משהו נוסף שחשוב לך שנדע?"
          hint="לא חובה."
          maxLength={1000}
          rows={3}
          value={v.message}
          onChange={(e) => set('message', e.target.value)}
        />
        <Honeypot value={v.website} onChange={(w) => set('website', w)} />
        <PrivacyNote>
          נשתמש בפרטים רק כדי לחזור אליך לגבי ההצעה. אין חובה חוקית למסור אותם, אבל בלעדיהם לא נוכל לחזור אליך. רק צוות העמותה רואה אותם.{' '}
        </PrivacyNote>
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy} className="w-full">שליחת ההצעה</Button>
      </form>
    </div>
  );
}
