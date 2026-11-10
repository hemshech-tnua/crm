import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useAuth, useMe } from '@/lib/auth';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { Button, ErrorBox, Input, Notice } from '@/ui/kit';

const RESEND_SECONDS = 45;

type Mode = 'email' | 'sms' | 'password';
const MODE_LINK: Record<Mode, string> = {
  email: 'כניסה עם קוד במייל',
  sms: 'כניסה עם קוד בטלפון (SMS)',
  password: 'כניסה עם אימייל וסיסמה',
};
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function LoginPage() {
  const { session, ready } = useAuth();
  const me = useMe();
  const location = useLocation();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('email');
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (ready && session && me.data?.is_active) {
    return <Navigate to={me.data.must_change_password ? '/password' : from} replace />;
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-3xl">כניסת צוות</h1>
      <p className="mt-1 mb-6 text-muted">המערכת של צוות העמותה. לוחמים שרוצים להירשם למפגש לא צריכים חשבון.</p>
      {params.get('denied') && session && (
        <div className="mb-4"><Notice tone="warn" icon="alert">החשבון הזה לא פעיל במערכת. פנו למנהל/ת.</Notice></div>
      )}
      {mode === 'password' ? <PasswordLogin from={from} /> : <CodeLogin key={mode} channel={mode} from={from} />}
      <div className="mt-6 flex flex-col items-start gap-1">
        {(['email', 'sms', 'password'] as const).filter((m) => m !== mode).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className="min-h-11 text-[0.95rem] font-semibold text-tide underline underline-offset-4">
            {MODE_LINK[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Email or phone → one-time code → in. Sign-ups are off, so only an existing staff account gets a code.
 * The answer after "send" is the same for every address, so the form does not reveal who is on the team.
 */
function CodeLogin({ channel, from }: { channel: 'email' | 'sms'; from: string }) {
  const navigate = useNavigate();
  const sms = channel === 'sms';
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (to: string) => {
    setError(null);
    setBusy(true);
    const { error: err } = sms
      ? await supabase.auth.signInWithOtp({ phone: to, options: { shouldCreateUser: false } })
      : await supabase.auth.signInWithOtp({ email: to, options: { shouldCreateUser: false } });
    setBusy(false);
    if (err && /rate|too many|frequency|seconds/i.test(err.message)) {
      setError('נשלחו יותר מדי קודים. נסו שוב בעוד כמה דקות.');
      return;
    }
    // any other answer (including "not a staff phone") looks the same to the person typing
    setSentTo(to);
    setCode('');
    setWait(RESEND_SECONDS);
  };

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    if (!sms) {
      const to = phone.trim().toLowerCase();
      if (!emailRe.test(to)) {
        setError('כתובת האימייל לא תקינה.');
        return;
      }
      void send(to);
      return;
    }
    const to = normalizePhone(phone);
    if (!to || !/^\+9725\d{8}$|^\+(?!972)[1-9]\d{7,14}$/.test(to)) {
      setError('צריך מספר טלפון נייד, למשל 050-1234567.');
      return;
    }
    void send(to);
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    const token = code.replace(/\D/g, '');
    if (token.length < 6) {
      setError('הקוד הוא 6 ספרות.');
      return;
    }
    setError(null);
    setBusy(true);
    const { error: err } = sms
      ? await supabase.auth.verifyOtp({ phone: sentTo, token, type: 'sms' })
      : await supabase.auth.verifyOtp({ email: sentTo, token, type: 'email' });
    setBusy(false);
    if (err) {
      setError(/rate|too many/i.test(err.message) ? 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.' : 'הקוד לא נכון או שפג תוקפו. אפשר לבקש קוד חדש.');
      return;
    }
    navigate(from, { replace: true });
  };

  if (!sentTo) {
    return (
      <form onSubmit={submitPhone} className="flex flex-col gap-4" noValidate aria-label={sms ? 'בקשת קוד בטלפון' : 'בקשת קוד במייל'}>
        {sms ? (
          <Input
            label="מספר הטלפון הנייד שלך"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            ltr
            maxLength={20}
            placeholder="050-1234567"
            className="num"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
          />
        ) : (
          <Input
            label="כתובת האימייל שלך"
            type="email"
            inputMode="email"
            autoComplete="email"
            ltr
            maxLength={254}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
          />
        )}
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy} disabled={!phone.trim()}>{sms ? 'שליחת קוד ב-SMS' : 'שליחת קוד למייל'}</Button>
        <p className="text-sm text-muted">{sms ? 'נשלח קוד חד־פעמי למספר שרשום אצלנו בצוות.' : 'נשלח קוד חד־פעמי לכתובת שרשומה אצלנו בצוות.'} אין צורך בסיסמה.</p>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate aria-label="הקוד שנשלח">
      <p className="text-[1.05rem]">
        {sms
          ? <>אם המספר <span className="num font-semibold" dir="ltr">{formatPhone(sentTo)}</span> רשום בצוות, נשלח אליו עכשיו קוד ב-SMS.</>
          : <>אם הכתובת <span className="num font-semibold" dir="ltr">{sentTo}</span> רשומה בצוות, נשלח אליה עכשיו קוד. כדאי לבדוק גם בתיקיית הספאם.</>}
      </p>
      <Input
        label={sms ? 'הקוד מה-SMS' : 'הקוד מהמייל'}
        inputMode="numeric"
        autoComplete="one-time-code"
        ltr
        maxLength={8}
        autoFocus
        className="num h-16! text-center text-3xl tracking-[0.4em]"
        value={code}
        onChange={(e) => { setCode(e.target.value); setError(null); }}
      />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy} disabled={code.replace(/\D/g, '').length < 6}>כניסה</Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" disabled={wait > 0 || busy} onClick={() => send(sentTo)} className="min-h-11 font-semibold text-tide underline underline-offset-4 disabled:text-faint disabled:no-underline">
          {wait > 0 ? <>שליחה מחדש בעוד <span className="num">{wait}</span> שניות</> : 'שליחת קוד חדש'}
        </button>
        <button type="button" onClick={() => { setSentTo(null); setCode(''); setError(null); }} className="min-h-11 font-semibold text-muted underline underline-offset-4">
          {sms ? 'מספר אחר' : 'כתובת אחרת'}
        </button>
      </div>
    </form>
  );
}

function PasswordLogin({ from }: { from: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      // the same message for a wrong email and a wrong password: do not reveal which accounts exist
      setError(/rate|too many/i.test(err.message) ? 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.' : 'האימייל או הסיסמה לא נכונים.');
      return;
    }
    navigate(from, { replace: true });
  };

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-label="כניסה בסיסמה">
        <Input label="אימייל" type="email" autoComplete="username" ltr required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="סיסמה" type="password" autoComplete="current-password" ltr required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy} disabled={!email || !password}>כניסה</Button>
      </form>
      <p className="mt-6 text-sm text-muted">שכחת סיסמה? מנהל/ת המערכת יכול/ה לאפס אותה מתוך ההגדרות.</p>
    </>
  );
}
