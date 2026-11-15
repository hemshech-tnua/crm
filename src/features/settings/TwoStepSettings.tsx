import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { Badge, Button, ErrorBox, Input, Notice, Panel } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';

/**
 * Two-step sign-in (TOTP). Once on, every sign-in also asks for a 6-digit code from an authenticator app, and the
 * database gives the session no role until it is entered. Turning it off needs a session that already passed it.
 */
export function TwoStepSettings() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = !!me.data?.mfa_enrolled;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      // a setup that was started and never finished is cleared first
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'המשך תנועה', issuer: 'המשך תנועה' });
      if (err) throw err;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!enroll || busy) return;
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) return setError('הקוד הוא 6 ספרות.');
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: digits });
      if (err) throw { message: 'mfa_invalid' };
      setEnroll(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('האימות הדו־שלבי הופעל');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const ok = await confirm({
      title: 'לכבות את האימות הדו־שלבי?',
      body: 'מהכניסה הבאה תספיק הסיסמה בלבד. אפשר להפעיל שוב בכל רגע.',
      confirm: 'כן, לכבות',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        const { error: err } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (err) throw err;
      }
      await supabase.auth.refreshSession();
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('האימות הדו־שלבי כובה');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="אימות דו־שלבי" actions={on ? <Badge tone="good" icon="check">פעיל</Badge> : <Badge>כבוי</Badge>}>
      {on ? (
        <>
          <p className="text-body text-ink-soft">בכל כניסה, אחרי הסיסמה, המערכת מבקשת קוד מאפליקציית האימות בטלפון. גם מי שישיג את הסיסמה לא ייכנס בלי הטלפון.</p>
          <Button variant="secondary" className="mt-4" busy={busy} onClick={disable}>כיבוי</Button>
        </>
      ) : enroll ? (
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate aria-label="הפעלת אימות דו־שלבי">
          <ol className="list-decimal space-y-1 ps-5 text-body text-ink-soft">
            <li>מתקינים בטלפון אפליקציית אימות (Google Authenticator, Microsoft Authenticator או דומה).</li>
            <li>באפליקציה בוחרים "הוספה" וסורקים את הברקוד.</li>
            <li>מקלידים כאן את הקוד בן 6 הספרות שמופיע באפליקציה.</li>
          </ol>
          <div className="self-center rounded-[var(--radius-panel)] bg-white p-3"><img src={enroll.qr} alt="ברקוד להוספת המשתמש לאפליקציית האימות" width={200} height={200} /></div>
          <p className="text-small text-muted">אי אפשר לסרוק? מקלידים באפליקציה את המפתח: <span className="num select-all break-all" dir="ltr">{enroll.secret}</span></p>
          <Input label="קוד מהאפליקציה" inputMode="numeric" autoComplete="one-time-code" maxLength={7} ltr className="num text-xl tracking-[0.3em]"
            value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <ErrorBox error={error} />}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>הפעלה</Button>
            <Button variant="ghost" onClick={() => setEnroll(null)}>ביטול</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-body text-ink-soft">שכבת הגנה נוספת: בכל כניסה, אחרי הסיסמה, מקלידים גם קוד מתחלף מאפליקציה בטלפון. מומלץ מאוד למנהלים.</p>
          {error && <div className="mt-3"><ErrorBox error={error} /></div>}
          <Button className="mt-4" icon="shield" busy={busy} onClick={start}>הפעלת אימות דו־שלבי</Button>
          {me.data?.role === 'admin' && <div className="mt-4"><Notice>אם הטלפון יאבד, מנהל/ת אחר/ת יכול/ה לאפס את האימות במסך המשתמשים.</Notice></div>}
        </>
      )}
    </Panel>
  );
}
