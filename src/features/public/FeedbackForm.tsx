import { useId, useState, type FormEvent } from 'react';
import { errorCode, errorMessage } from '@/lib/errors';
import { normalizePhone } from '@/lib/phone';
import { Button, ErrorBox, Input, Rating, Textarea } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { submitFeedback, type FeedbackContext } from './api';
import { theActivity } from './eventText';
import { Honeypot } from './shared';

const MAX_COMMENT = 1000;

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-sm font-medium text-bad" role="alert">
      <Icon name="alert" size={15} />
      {children}
    </p>
  );
}

/**
 * The questions after a meeting (questionnaire Q40 + the overall rating, assumption H5).
 * Personal (token) feedback is linked to the registration and can be edited; the event-link version may add a phone.
 */
export function FeedbackForm({ ctx, token, onDone, submitLabel = 'שליחת המשוב' }: {
  ctx: FeedbackContext;
  token?: string | null;
  onDone: () => void;
  submitLabel?: string;
}) {
  const ids = useId();
  const ex = ctx.existing;
  const [overall, setOverall] = useState<number | null>(ex?.overall ?? null);
  const [activity, setActivity] = useState<number | null>(ex?.activity ?? null);
  const [lecture, setLecture] = useState<number | null>(ex?.lecture ?? null);
  const [comment, setComment] = useState(ex?.comment ?? '');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<{ overall?: string; phone?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const personal = !!token && ctx.personal;
  const e = ctx.event;

  const focus = (id: string) => {
    const el = document.getElementById(id);
    const target = el?.matches('input') ? el : el?.querySelector<HTMLElement>('input');
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setError(null);
    const errs: typeof errors = {};
    if (!overall) errs.overall = 'בחרו דירוג למפגש (מ-1 עד 5).';
    if (!personal && phone.trim() && !normalizePhone(phone)) errs.phone = errorMessage({ message: 'invalid_phone' });
    setErrors(errs);
    if (errs.overall) return focus(`${ids}-overall`);
    if (errs.phone) return focus(`${ids}-phone`);
    setBusy(true);
    try {
      const ratings = {
        overall: overall!,
        activity: ctx.has_activity ? activity : null,
        lecture: ctx.has_lecture ? lecture : null,
        comment: comment.trim() || null,
        website,
      };
      await submitFeedback(
        personal ? { token: token!, ...ratings } : { event: e.code, phone: normalizePhone(phone) ?? undefined, ...ratings },
      );
      onDone();
    } catch (err) {
      setBusy(false);
      if (errorCode(err) === 'invalid_phone') {
        setErrors({ phone: errorMessage(err) });
        return focus(`${ids}-phone`);
      }
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" aria-label="משוב על המפגש">
      <div id={`${ids}-overall`}>
        <Rating legend="איך היה המפגש?" required value={overall} onChange={(n) => { setOverall(n); setErrors((x) => ({ ...x, overall: undefined })); }} />
        <FieldError>{errors.overall}</FieldError>
      </div>
      {ctx.has_activity && (
        <Rating legend={`מה דעתך על ${theActivity(e)}?`} value={activity} onChange={setActivity} />
      )}
      {ctx.has_lecture && (
        <Rating legend={e.speaker_name ? `מה דעתך על ההרצאה של ${e.speaker_name}?` : 'מה דעתך על ההרצאה?'} value={lecture} onChange={setLecture} />
      )}
      <Textarea
        label="רוצה להוסיף משהו?"
        hint={
          <span className="flex justify-between gap-3">
            <span>לא חובה. מה היה טוב, מה אפשר לשפר, רעיון לנושא הבא.</span>
            <span className="num shrink-0">{comment.length}/{MAX_COMMENT}</span>
          </span>
        }
        maxLength={MAX_COMMENT}
        rows={4}
        value={comment}
        onChange={(x) => setComment(x.target.value)}
      />
      {!personal && (
        <Input
          id={`${ids}-phone`}
          label="הטלפון שלך"
          hint="לא חובה – כדי שנדע שזה את/ה."
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          ltr
          maxLength={20}
          placeholder="050-1234567"
          value={phone}
          onChange={(x) => { setPhone(x.target.value); setErrors((v) => ({ ...v, phone: undefined })); }}
          error={errors.phone}
        />
      )}
      <Honeypot value={website} onChange={setWebsite} />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy} className="w-full">{submitLabel}</Button>
    </form>
  );
}
