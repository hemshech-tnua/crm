import { useId, useState, type FormEvent } from 'react';
import { errorCode, errorMessage } from '@/lib/errors';
import { normalizePhone } from '@/lib/phone';
import { Button, ButtonLink, ErrorBox, Input, Notice } from '@/ui/kit';
import { requestMembership, type MembershipResult } from './api';
import { forgetPerson, knownPeople, type KnownPerson } from './device';
import { PhoneExample, cleanText, nameError, phoneError } from './PersonForm';
import { Honeypot, PrivacyNote, ResultTitle, SuccessMark, TriList, usePageTitle } from './shared';

/**
 * #/member — "I want to join the association". Linked from the thank-you message sent after a meeting.
 * A phone that checked in before is recognised (one tap); otherwise name + phone. Either way a coordinator gets a
 * task to call back with the details: joining itself is decided by the association, not by this form.
 */
export function MemberPage() {
  usePageTitle('הצטרפות לעמותה');
  const [people, setPeople] = useState<KnownPerson[]>(() => knownPeople());
  const [form, setForm] = useState(people.length === 0);
  const [done, setDone] = useState<MembershipResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (done) return <Done result={done} />;
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div className="lg:sticky lg:top-6">
        <h1 className="font-display text-title">הצטרפו לעמותה</h1>
        <p className="mt-2 text-lg text-ink-soft">
          המשך תנועה היא הבית ללוחמים ולוחמות באזרחות, ואתם מוזמנים להיות חלק ממנה. השאירו פרטים, ומישהו מהצוות יחזור אליכם עם כל מה שצריך לדעת על ההצטרפות.
        </p>
        <TriList
          className="mt-4"
          items={['חלק מקהילה של לוחמים ולוחמות', 'עדכונים ראשונים על מפגשים ופעילויות', 'אפשר לעזור ולהתנדב']}
        />
      </div>
      <div className="flex flex-col gap-5 lg:rounded-[var(--radius-panel)] lg:border lg:border-edge lg:bg-paper lg:p-8">
        {notice && <Notice tone="warn" icon="alert">{notice}</Notice>}
        {!form && people.length > 0 ? (
          <ByPhone
            people={people}
            onDone={setDone}
            onForgotten={(device) => {
              forgetPerson(device);
              const rest = knownPeople();
              setPeople(rest);
              setNotice('הטלפון כבר לא זוכר אותך. אפשר להשאיר שם וטלפון.');
              if (!rest.length) setForm(true);
            }}
            onOther={() => setForm(true)}
          />
        ) : (
          <ByForm onDone={setDone} />
        )}
      </div>
    </div>
  );
}

function ByPhone({ people, onDone, onForgotten, onOther }: {
  people: KnownPerson[];
  onDone: (r: MembershipResult) => void;
  onForgotten: (device: string) => void;
  onOther: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const one = people.length === 1 ? people[0] : null;
  const pick = async (p: KnownPerson) => {
    setBusy(p.device);
    setError(null);
    try {
      const r = await requestMembership({ device: p.device });
      if (r.result === 'device_invalid') onForgotten(p.device);
      else onDone({ ...r, first_name: r.first_name ?? p.name });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg">{one ? (one.name ? `${one.name}, הטלפון זוכר אותך מהמפגש. מספיקה לחיצה אחת.` : 'הטלפון זוכר אותך מהמפגש. מספיקה לחיצה אחת.') : 'מהטלפון הזה נכנסו כמה אנשים. מי רוצה להצטרף?'}</p>
      {error && <ErrorBox error={error} />}
      {people.map((p) => (
        <Button key={p.device} size="lg" busy={busy === p.device} disabled={!!busy && busy !== p.device} onClick={() => pick(p)}
          className={one ? 'h-20! w-full text-2xl!' : 'h-16! w-full text-xl!'}>
          {one ? 'אני רוצה להצטרף' : `${p.name ?? 'אני'} רוצה להצטרף`}
        </Button>
      ))}
      <button type="button" onClick={onOther} className="min-h-11 self-center px-3 text-[1.05rem] font-semibold text-tide underline underline-offset-4">
        {one?.name ? `לא ${one.name}? מילוי שם וטלפון` : 'מישהו אחר? מילוי שם וטלפון'}
      </button>
    </div>
  );
}

function ByForm({ onDone }: { onDone: (r: MembershipResult) => void }) {
  const ids = useId();
  const [v, setV] = useState({ full_name: '', phone: '', website: '' });
  const [errors, setErrors] = useState<{ full_name?: string; phone?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const errs = { full_name: nameError(v.full_name), phone: phoneError(v.phone) };
    setErrors(errs);
    const first = errs.full_name ? 'full_name' : errs.phone ? 'phone' : null;
    if (first) {
      document.getElementById(`${ids}-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      onDone(await requestMembership({ full_name: cleanText(v.full_name), phone: normalizePhone(v.phone) ?? v.phone.trim(), website: v.website }));
    } catch (err) {
      setBusy(false);
      const c = errorCode(err);
      if (c === 'invalid_name') setErrors({ full_name: errorMessage(err) });
      else if (c === 'invalid_phone') setErrors({ phone: errorMessage(err) });
      else setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="בקשת הצטרפות לעמותה">
      <Input
        id={`${ids}-full_name`}
        label="שם מלא"
        autoComplete="name"
        maxLength={80}
        value={v.full_name}
        onChange={(e) => { setV((x) => ({ ...x, full_name: e.target.value })); setErrors((x) => ({ ...x, full_name: undefined })); }}
        error={errors.full_name}
      />
      <Input
        id={`${ids}-phone`}
        label="טלפון"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        ltr
        maxLength={20}
        hint={<PhoneExample />}
        className="num"
        value={v.phone}
        onChange={(e) => { setV((x) => ({ ...x, phone: e.target.value })); setErrors((x) => ({ ...x, phone: undefined })); }}
        error={errors.phone}
      />
      <Honeypot value={v.website} onChange={(w) => setV((x) => ({ ...x, website: w }))} />
      <PrivacyNote>
        נשתמש בפרטים רק כדי לחזור אליך לגבי ההצטרפות לעמותה. אין חובה חוקית למסור אותם, אבל בלעדיהם לא נוכל לחזור אליך. רק צוות העמותה רואה אותם.{' '}
      </PrivacyNote>
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" cta busy={busy} className="w-full">אני רוצה להצטרף</Button>
    </form>
  );
}

function Done({ result: r }: { result: MembershipResult }) {
  const name = r.first_name ? `${r.first_name}, ` : '';
  const title = r.result === 'already_member' ? `${name}כבר יש לך חברות בעמותה` : r.result === 'already_requested' ? `${name}הבקשה שלך כבר אצלנו` : `תודה${r.first_name ? `, ${r.first_name}` : ''}! קיבלנו`;
  const body = r.result === 'already_member'
    ? 'תודה שבחרת להיות חלק מהעמותה. נתראה במפגש הבא!'
    : 'מישהו מהצוות יחזור אליך בימים הקרובים עם כל הפרטים על ההצטרפות.';
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 pt-2 text-center">
      <SuccessMark />
      <ResultTitle className="mt-2">{title}</ResultTitle>
      <p className="max-w-sm text-lg text-ink-soft">{body}</p>
      <ButtonLink to="/" variant="secondary" className="mt-3">למפגשים הקרובים</ButtonLink>
    </div>
  );
}
