import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { signOut, useAuth, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { Button, ErrorBox, Input, Skeleton } from '@/ui/kit';

/** #/mfa — second step of sign-in for a member who turned on two-step sign-in (a code from an authenticator app). */
export function MfaPage() {
  const { session, ready } = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  if (ready && !session) return <Navigate to="/login" replace />;
  if (!ready || me.isLoading) return <div className="mx-auto max-w-sm"><Skeleton lines={4} /></div>;
  if (me.data && (!me.data.mfa_enrolled || me.data.aal === 'aal2')) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const digits = code.replace(/\D/g, '');
    setError(null);
    if (digits.length !== 6) {
      setFieldError('הקוד צריך להיות בן 6 ספרות.');
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.[0];
      if (!factor) throw { message: 'mfa_invalid' };
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
      if (err) throw { message: 'mfa_invalid' };
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      // the button was busy (focus lost): back to the empty field, ready for the current code
      requestAnimationFrame(() => codeRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-title-sm sm:text-title">אימות דו־שלבי</h1>
      <p className="mt-1 mb-5 text-muted">
        פותחים את אפליקציית האימות בטלפון (למשל Google Authenticator או Microsoft Authenticator) ומקלידים את הקוד בן 6 הספרות של המשך תנועה.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-label="אישור הכניסה בקוד">
        <Input
          ref={codeRef}
          label="קוד אימות"
          inputMode="numeric"
          autoComplete="one-time-code"
          enterKeyHint="go"
          maxLength={7}
          ltr
          autoFocus
          className="num h-14! text-2xl tracking-[0.3em]"
          error={fieldError}
          value={code}
          onChange={(e) => { setCode(e.target.value); setFieldError(null); }}
        />
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy}>אישור הכניסה</Button>
        <Button variant="ghost" onClick={async () => { await signOut(); navigate('/login'); }}>יציאה</Button>
      </form>
      <p className="mt-5 text-small text-muted">איבדת את הטלפון עם האפליקציה? מנהלים אחרים יכולים לאפס את האימות הדו־שלבי שלך במסך המשתמשים.</p>
    </div>
  );
}
