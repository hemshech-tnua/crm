import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { signInWithPhonePassword, useAuth, useMe } from '@/lib/auth';
import { formatPhone, normalizePhone, PHONE_EXAMPLE } from '@/lib/phone';
import { Button, ErrorBox, Input, Notice } from '@/ui/kit';

const RESEND_SECONDS = 45;

type Mode = 'email' | 'sms' | 'password';
const MODE_LINK: Record<Mode, string> = {
  email: 'כניסה עם קוד באימייל',
  sms: 'כניסה עם קוד בטלפון (SMS)',
  password: 'כניסה עם טלפון או אימייל וסיסמה',
};
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOO_MANY = 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.';
const CODE_LENGTH = 'הקוד צריך להיות בן 6 ספרות.';
/** After a failed attempt: back to the field to fix, its text selected so typing replaces it. */
const refocus = (el: HTMLInputElement | null) => requestAnimationFrame(() => { el?.focus(); el?.select(); });

export function LoginPage() {
  const { session, ready } = useAuth();
  const me = useMe();
  const location = useLocation();
  const [params] = useSearchParams();
  // phone/email + password works without any mail or SMS service; the code options are one tap away
  const [mode, setMode] = useState<Mode>('password');
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (ready && session && me.data?.is_active) {
    return <Navigate to={me.data.must_change_password ? '/password' : from} replace />;
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-title-sm sm:text-title">כניסת צוות</h1>
      <p className="mt-1 mb-6 text-muted">המערכת של צוות העמותה. לוחמים שרוצים להירשם למפגש לא צריכים חשבון.</p>
      {params.get('denied') && session && (
        <div className="mb-4"><Notice tone="warn" icon="alert">החשבון הזה לא פעיל. אפשר לפנות למנהלי המערכת.</Notice></div>
      )}
      {mode === 'password' ? <PasswordLogin from={from} /> : <CodeLogin key={mode} channel={mode} from={from} />}
      <div className="mt-6 flex flex-col items-start gap-1">
        {(['email', 'sms', 'password'] as const).filter((m) => m !== mode).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className="min-h-11 text-body-sm font-semibold text-tide underline underline-offset-4">
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
  // a field error sits under the field (what to fix); a server answer goes in the box under the form
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const addressRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

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
      setError('נשלחו יותר מדי קודים. אפשר לנסות שוב בעוד כמה דקות.');
      return;
    }
    // any other answer (including "not a staff phone") looks the same to the person typing
    setSentTo(to);
    setCode('');
    setWait(RESEND_SECONDS);
  };

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const invalid = (msg: string) => { setFieldError(msg); addressRef.current?.focus(); };
    if (!sms) {
      const to = phone.trim().toLowerCase();
      if (!to) return invalid('צריך כתובת אימייל.');
      if (!emailRe.test(to)) return invalid('כתובת האימייל לא תקינה.');
      void send(to);
      return;
    }
    const to = normalizePhone(phone);
    if (!to || !/^\+9725\d{8}$|^\+(?!972)[1-9]\d{7,14}$/.test(to)) return invalid(`צריך מספר טלפון נייד, למשל ${PHONE_EXAMPLE}.`);
    void send(to);
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo || busy) return;
    const token = code.replace(/\D/g, '');
    setError(null);
    if (token.length < 6) {
      setFieldError(CODE_LENGTH);
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    const { error: err } = sms
      ? await supabase.auth.verifyOtp({ phone: sentTo, token, type: 'sms' })
      : await supabase.auth.verifyOtp({ email: sentTo, token, type: 'email' });
    setBusy(false);
    if (err) {
      setError(/rate|too many/i.test(err.message) ? TOO_MANY : 'הקוד לא נכון או שפג תוקפו. אפשר לבקש קוד חדש.');
      refocus(codeRef.current);
      return;
    }
    navigate(from, { replace: true });
  };

  if (!sentTo) {
    return (
      <form onSubmit={submitPhone} className="flex flex-col gap-4" noValidate aria-label={sms ? 'בקשת קוד בטלפון' : 'בקשת קוד באימייל'}>
        {sms ? (
          <Input
            ref={addressRef}
            label="מספר הטלפון הנייד שלך"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            ltr
            maxLength={20}
            placeholder={PHONE_EXAMPLE}
            className="num"
            error={fieldError}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setFieldError(null); setError(null); }}
          />
        ) : (
          <Input
            ref={addressRef}
            label="כתובת האימייל שלך"
            type="email"
            inputMode="email"
            autoComplete="email"
            ltr
            maxLength={254}
            error={fieldError}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setFieldError(null); setError(null); }}
          />
        )}
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy}>{sms ? 'שליחת קוד ב־SMS' : 'שליחת קוד לאימייל'}</Button>
        <p className="text-small text-muted">{sms ? 'הקוד החד־פעמי יישלח למספר שרשום בצוות.' : 'הקוד החד־פעמי יישלח לכתובת שרשומה בצוות.'} אין צורך בסיסמה.</p>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate aria-label="הקוד שנשלח">
      <p className="text-body">
        {sms
          ? <>אם המספר <span className="num font-semibold" dir="ltr">{formatPhone(sentTo)}</span> רשום בצוות, נשלח אליו עכשיו קוד ב־SMS.</>
          : <>אם הכתובת <span className="num font-semibold" dir="ltr">{sentTo}</span> רשומה בצוות, נשלח אליה עכשיו קוד. כדאי לבדוק גם בתיקיית הספאם.</>}
      </p>
      <Input
        ref={codeRef}
        label={sms ? 'הקוד מה־SMS' : 'הקוד מהאימייל'}
        inputMode="numeric"
        autoComplete="one-time-code"
        ltr
        maxLength={8}
        autoFocus
        className="num h-16! text-center text-3xl tracking-[0.4em]"
        error={fieldError}
        value={code}
        onChange={(e) => { setCode(e.target.value); setFieldError(null); setError(null); }}
      />
      {error && <ErrorBox error={error} />}
      <Button type="submit" size="lg" busy={busy}>כניסה</Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
        <button type="button" disabled={wait > 0 || busy} onClick={() => send(sentTo)} className="min-h-11 font-semibold text-tide underline underline-offset-4 disabled:text-faint disabled:no-underline">
          {wait > 0 ? <>שליחה מחדש בעוד <span className="num">{wait}</span> שניות</> : 'שליחת קוד חדש'}
        </button>
        <button type="button" onClick={() => { setSentTo(null); setCode(''); setError(null); setFieldError(null); }} className="min-h-11 font-semibold text-muted underline underline-offset-4">
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
  // validate on submit: the button stays active, an empty field says what is missing and gets the focus
  const [missing, setMissing] = useState<{ id?: string; password?: string }>({});
  const idRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const fail = (message: string) => {
    setBusy(false);
    setError(message);
    // the sign-in button was busy, so the focus was lost: back to the password, ready to type again
    refocus(pwRef.current);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const id = email.trim();
    const empty = { id: id ? undefined : 'צריך טלפון נייד או אימייל.', password: password ? undefined : 'צריך סיסמה.' };
    setMissing(empty);
    if (empty.id || empty.password) {
      (empty.id ? idRef : pwRef).current?.focus();
      return;
    }
    setBusy(true);
    if (!id.includes('@')) {
      // a phone number: the server finds the staff account by phone
      const phone = normalizePhone(id);
      try {
        if (!phone) throw { message: 'invalid_login' };
        await signInWithPhonePassword(phone, password);
      } catch (x) {
        fail((x as { message?: string }).message === 'rate_limited' ? TOO_MANY : 'הטלפון או הסיסמה לא נכונים.');
        return;
      }
      setBusy(false);
      navigate(from, { replace: true });
      return;
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email: id, password });
    if (err) {
      // the same message for a wrong email and a wrong password: do not reveal which accounts exist
      fail(/rate|too many/i.test(err.message) ? TOO_MANY : 'האימייל או הסיסמה לא נכונים.');
      return;
    }
    setBusy(false);
    navigate(from, { replace: true });
  };

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-label="כניסה בסיסמה">
        <Input ref={idRef} label="טלפון נייד או אימייל" autoComplete="username" ltr required error={missing.id}
          value={email} onChange={(e) => { setEmail(e.target.value); setMissing((m) => ({ ...m, id: undefined })); }} />
        <Input ref={pwRef} label="סיסמה" type="password" autoComplete="current-password" ltr required error={missing.password}
          value={password} onChange={(e) => { setPassword(e.target.value); setMissing((m) => ({ ...m, password: undefined })); }} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy}>כניסה</Button>
      </form>
      <p className="mt-6 text-small text-muted">שכחת סיסמה? מנהלי המערכת יכולים לאפס אותה מתוך ההגדרות.</p>
    </>
  );
}
