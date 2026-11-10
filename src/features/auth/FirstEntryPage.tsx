import { useState, type FormEvent } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = email.trim().toLowerCase();
    if (!emailRe.test(a)) return setError('כתובת האימייל לא תקינה.');
    if (a !== again.trim().toLowerCase()) return setError('שתי הכתובות לא זהות. כדאי לבדוק שאין טעות הקלדה.');
    setError(null);
    setBusy(true);
    try {
      await claimInvite(token, a);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-3xl">ברוך/ה הבא/ה לצוות</h1>
      <p className="mt-1 mb-6 text-muted">
        כניסה ראשונה למערכת של המשך תנועה. כותבים את כתובת האימייל שלך, ונכנסים. מהפעם הבאה הכניסה בקוד שנשלח למייל הזה, בלי סיסמה.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-label="כניסה ראשונה">
        <Input label="האימייל שלך" type="email" inputMode="email" autoComplete="email" ltr value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
        <Input label="שוב, לאימות" type="email" inputMode="email" autoComplete="off" ltr value={again} onChange={(e) => { setAgain(e.target.value); setError(null); }} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy} disabled={!email || !again}>כניסה</Button>
      </form>
      <p className="mt-6 text-sm text-muted">הקישור אישי, עובד פעם אחת ותקף 7 ימים. אין להעביר אותו לאחרים.</p>
    </div>
  );
}
