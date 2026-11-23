import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { staffAdmin, useAuth, useMe, signOut } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { Button, ErrorBox, Input, Notice } from '@/ui/kit';
import { useToast } from '@/ui/feedback';

export function PasswordPage() {
  const { session, ready } = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // validate on submit: the field to fix says why and gets the focus; a server answer goes in the box under the form
  const [fields, setFields] = useState<{ pw?: string; pw2?: string }>({});
  const pwRef = useRef<HTMLInputElement>(null);
  const pw2Ref = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  if (ready && !session) return <Navigate to="/login" replace />;
  if (me.data?.mfa_enrolled && me.data.aal !== 'aal2') return <Navigate to="/mfa" replace state={{ from: '/password' }} />;

  const strong = pw.length >= 10 && /\d/.test(pw) && /[A-Za-z֐-׿]/.test(pw);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const next = {
      pw: !strong ? 'הסיסמה צריכה לכלול לפחות 10 תווים, אותיות וספרות.' : undefined,
      pw2: strong && pw !== pw2 ? 'שתי הסיסמאות לא זהות.' : undefined,
    };
    setFields(next);
    if (next.pw || next.pw2) {
      (next.pw ? pwRef : pw2Ref).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await staffAdmin({ action: 'change_password', new_password: pw });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('הסיסמה עודכנה');
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-title-sm sm:text-title">בחירת סיסמה</h1>
      {me.data?.must_change_password ? (
        <div className="mt-3 mb-5"><Notice>נכנסת עם סיסמה זמנית. כדי להמשיך צריך לבחור סיסמה אישית, שרק לך ידועה.</Notice></div>
      ) : (
        <p className="mt-1 mb-5 text-muted">החלפת הסיסמה של {me.data?.full_name}.</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input ref={pwRef} label="סיסמה חדשה" type="password" autoComplete="new-password" ltr error={fields.pw}
          value={pw} onChange={(e) => { setPw(e.target.value); setFields((f) => ({ ...f, pw: undefined })); }}
          hint="לפחות 10 תווים, עם אותיות וספרות. משפט קצר שקל לזכור עובד טוב." />
        <Input ref={pw2Ref} label="שוב, לאימות" type="password" autoComplete="new-password" ltr error={fields.pw2}
          value={pw2} onChange={(e) => { setPw2(e.target.value); setFields((f) => ({ ...f, pw2: undefined })); }} />
        {error && <div ref={errorRef} tabIndex={-1} className="outline-none"><ErrorBox error={error} /></div>}
        <Button type="submit" size="lg" busy={busy}>שמירת הסיסמה</Button>
        <Button variant="ghost" onClick={async () => { await signOut(); navigate('/login'); }}>יציאה</Button>
      </form>
    </div>
  );
}
