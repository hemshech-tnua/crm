import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { claimInvite } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { Button, ErrorBox, Input } from '@/ui/kit';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** #/welcome/:token — a staff member's first entry: they type their own email once, and from then on sign in with a code to it. */
export function FirstEntryPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [again, setAgain] = useState('');
  // validate on submit: the field to fix says why and gets the focus; a server answer (an old link) goes in the box
  const [fields, setFields] = useState<{ email?: string; again?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const againRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const a = email.trim().toLowerCase();
    const next = {
      email: !a ? 'צריך כתובת אימייל.' : !emailRe.test(a) ? 'כתובת האימייל לא תקינה.' : undefined,
      again: !again.trim() ? 'צריך להקליד את הכתובת שוב.' : emailRe.test(a) && a !== again.trim().toLowerCase() ? 'שתי הכתובות לא זהות. כדאי לבדוק שאין טעות הקלדה.' : undefined,
    };
    setFields(next);
    if (next.email || next.again) {
      (next.email ? emailRef : againRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await claimInvite(token, a);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      // the button was busy (focus lost): move to the message, so it is read and the next Tab continues from it
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-title-sm sm:text-title">ברוכים הבאים לצוות</h1>
      <p className="mt-1 mb-6 text-muted">
        כניסה ראשונה למערכת של המשך תנועה. כותבים את כתובת האימייל שלך ונכנסים. מהפעם הבאה הכניסה בקוד שנשלח לאימייל הזה, בלי סיסמה.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-label="כניסה ראשונה">
        <Input ref={emailRef} label="האימייל שלך" type="email" inputMode="email" autoComplete="email" ltr error={fields.email}
          value={email} onChange={(e) => { setEmail(e.target.value); setFields((f) => ({ ...f, email: undefined })); setError(null); }} />
        <Input ref={againRef} label="שוב, לאימות" type="email" inputMode="email" autoComplete="off" ltr error={fields.again}
          value={again} onChange={(e) => { setAgain(e.target.value); setFields((f) => ({ ...f, again: undefined })); setError(null); }} />
        {error && <div ref={errorRef} tabIndex={-1} className="outline-none"><ErrorBox error={error} /></div>}
        <Button type="submit" size="lg" busy={busy}>כניסה</Button>
      </form>
      <p className="mt-6 text-small text-muted">הקישור אישי, עובד פעם אחת ותקף 48 שעות. לא להעביר אותו לאחרים.</p>
    </div>
  );
}
