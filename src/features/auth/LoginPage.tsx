import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useAuth, useMe } from '@/lib/auth';
import { Button, ErrorBox, Input, Notice } from '@/ui/kit';

export function LoginPage() {
  const { session, ready } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (ready && session && me.data?.is_active) {
    return <Navigate to={me.data.must_change_password ? '/password' : from} replace />;
  }

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
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-3xl">כניסת צוות</h1>
      <p className="mt-1 mb-6 text-muted">המערכת של צוות העמותה. לוחמים שרוצים להירשם למפגש לא צריכים חשבון.</p>
      {params.get('denied') && session && (
        <div className="mb-4"><Notice tone="warn" icon="alert">החשבון הזה לא פעיל במערכת. פנו למנהל/ת.</Notice></div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input label="אימייל" type="email" autoComplete="username" ltr required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="סיסמה" type="password" autoComplete="current-password" ltr required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" busy={busy} disabled={!email || !password}>כניסה</Button>
      </form>
      <p className="mt-6 text-sm text-muted">שכחת סיסמה? מנהל/ת המערכת יכול/ה לאפס אותה מתוך ההגדרות.</p>
    </div>
  );
}
