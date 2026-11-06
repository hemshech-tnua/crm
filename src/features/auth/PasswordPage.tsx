import { useState, type FormEvent } from 'react';
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

  if (ready && !session) return <Navigate to="/login" replace />;

  const strong = pw.length >= 10 && /\d/.test(pw) && /[A-Za-z֐-׿]/.test(pw);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!strong) return setError('הסיסמה צריכה לכלול לפחות 10 תווים, אותיות וספרות.');
    if (pw !== pw2) return setError('שתי הסיסמאות לא זהות.');
    setBusy(true);
    try {
      await staffAdmin({ action: 'change_password', new_password: pw });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('הסיסמה עודכנה');
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-3xl">בחירת סיסמה</h1>
      {me.data?.must_change_password ? (
        <div className="mt-3 mb-5"><Notice>נכנסת עם סיסמה זמנית. כדי להמשיך צריך לבחור סיסמה אישית שרק את/ה יודע/ת.</Notice></div>
      ) : (
        <p className="mt-1 mb-5 text-muted">החלפת הסיסמה של {me.data?.full_name}.</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input label="סיסמה חדשה" type="password" autoComplete="new-password" ltr value={pw} onChange={(e) => setPw(e.target.value)}
          hint="לפחות 10 תווים, עם אותיות וספרות. משפט קצר שקל לזכור עובד טוב." />
        <Input label="שוב, לאימות" type="password" autoComplete="new-password" ltr value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy}>שמירת הסיסמה</Button>
        <Button variant="ghost" onClick={async () => { await signOut(); navigate('/login'); }}>יציאה</Button>
      </form>
    </div>
  );
}
