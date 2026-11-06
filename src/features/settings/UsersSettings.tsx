import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { staffAdmin, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useStaffList } from '@/lib/data';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/labels';
import type { Role, Staff } from '@/lib/types';
import { Badge, Button, ChoiceGroup, ErrorBox, Input, Notice, Panel, Select, Skeleton } from '@/ui/kit';
import { Dialog, useConfirm, useCopy, useToast } from '@/ui/feedback';

const ROLES: Role[] = ['admin', 'coordinator', 'volunteer'];

export function UsersSettings() {
  const staff = useStaffList();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['staff'] });

  const run = async (id: string, body: Record<string, unknown>, done: string) => {
    setBusy(id);
    try {
      const res = await staffAdmin<{ temp_password?: string }>(body);
      await refresh();
      toast.success(done);
      return res;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const reset = async (s: Staff) => {
    if (!(await confirm({ title: `איפוס סיסמה ל${s.full_name}`, body: 'תיווצר סיסמה זמנית חדשה. הסיסמה הקודמת תפסיק לעבוד, ובכניסה הבאה תתבקש/י לבחור סיסמה אישית.', confirm: 'איפוס הסיסמה' }))) return;
    const res = await run(s.user_id, { action: 'reset_password', user_id: s.user_id }, 'נוצרה סיסמה זמנית');
    if (res?.temp_password) setSecret({ name: s.full_name, email: s.email, password: res.temp_password });
  };

  const toggle = async (s: Staff) => {
    if (s.is_active) {
      const ok = await confirm({ title: `חסימת ${s.full_name}`, body: 'המשתמש לא יוכל להיכנס, והגישה שלו לנתונים נחסמת מיד גם במכשירים שבהם הוא מחובר. אפשר להחזיר בכל רגע.', confirm: 'חסימה', danger: true });
      if (!ok) return;
    }
    await run(s.user_id, { action: 'update', user_id: s.user_id, is_active: !s.is_active }, s.is_active ? 'המשתמש נחסם' : 'המשתמש הופעל');
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel title="אנשי הצוות" padded={false} actions={<Button icon="userPlus" onClick={() => setCreating(true)}>משתמש חדש</Button>}>
        {staff.isLoading ? <div className="p-5"><Skeleton lines={4} /></div> : staff.error ? <div className="p-5"><ErrorBox error={errorMessage(staff.error)} /></div> : (
          <ul className="divide-y divide-line-soft">
            {(staff.data ?? []).map((s) => {
              const self = s.user_id === me.data?.user_id;
              return (
                <li key={s.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-48 flex-1">
                    <div className="font-semibold">{s.full_name} {self && <span className="text-sm font-normal text-muted">(את/ה)</span>}</div>
                    <div className="num text-sm text-muted" dir="ltr" style={{ textAlign: 'right' }}>{s.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!s.is_active && <Badge tone="bad">חסום</Badge>}
                    {s.is_active && s.must_change_password && <Badge tone="warn">ממתין לבחירת סיסמה</Badge>}
                    <Select aria-label={`תפקיד של ${s.full_name}`} value={s.role} disabled={self || busy === s.user_id} className="h-10 w-40"
                      onChange={(e) => run(s.user_id, { action: 'update', user_id: s.user_id, role: e.target.value }, 'התפקיד עודכן')}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                    <Button size="sm" variant="secondary" onClick={() => reset(s)} disabled={busy === s.user_id}>איפוס סיסמה</Button>
                    {!self && (
                      <Button size="sm" variant={s.is_active ? 'danger' : 'secondary'} onClick={() => toggle(s)} busy={busy === s.user_id}>
                        {s.is_active ? 'חסימה' : 'הפעלה מחדש'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title="מה כל תפקיד רואה">
        <ul className="flex flex-col gap-2 text-[0.95rem]">
          {ROLES.map((r) => <li key={r}><span className="font-semibold">{ROLE_LABEL[r]}:</span> <span className="text-ink-soft">{ROLE_HINT[r]}</span></li>)}
        </ul>
        <p className="mt-3 text-sm text-muted">ההרשאות נאכפות בשרת, לא רק במסך. מומלץ לתת לכל אדם את התפקיד המצומצם ביותר שמספיק לו.</p>
      </Panel>

      <CreateUser open={creating} onClose={() => setCreating(false)} onCreated={(name, email, password) => { setCreating(false); refresh(); setSecret({ name, email, password }); }} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

function CreateUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (name: string, email: string, password: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError('צריך שם מלא.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError('כתובת האימייל לא תקינה.');
    if (!role) return setError('צריך לבחור תפקיד.');
    setBusy(true);
    try {
      const res = await staffAdmin<{ temp_password: string }>({ action: 'create', full_name: name.trim(), email: email.trim(), role });
      onCreated(name.trim(), email.trim(), res.temp_password);
      setName(''); setEmail(''); setRole('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="משתמש חדש">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input label="שם מלא" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="אימייל (שם המשתמש לכניסה)" type="email" ltr value={email} onChange={(e) => setEmail(e.target.value)} required />
        <ChoiceGroup<Role> legend="תפקיד" required columns={1} value={role} onChange={setRole}
          options={ROLES.map((r) => ({ value: r, label: <span>{ROLE_LABEL[r]} <span className="block text-sm font-normal text-muted">{ROLE_HINT[r]}</span></span> }))} />
        {error && <ErrorBox error={error} />}
        <div className="flex gap-2"><Button type="submit" busy={busy}>יצירת המשתמש</Button><Button variant="ghost" onClick={onClose}>ביטול</Button></div>
      </form>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: { name: string; email: string; password: string } | null; onClose: () => void }) {
  const copy = useCopy();
  return (
    <Dialog open={!!secret} onClose={onClose} title="סיסמה זמנית" size="sm">
      {secret && (
        <div className="flex flex-col gap-4">
          <p>מסרו ל<span className="font-semibold">{secret.name}</span> את פרטי הכניסה באופן אישי (שיחה או הודעה פרטית). הסיסמה מוצגת עכשיו בלבד ולא נשמרת במערכת.</p>
          <div className="rounded-[var(--radius-control)] bg-mist p-4">
            <div className="text-sm text-muted">אימייל</div>
            <div className="num font-semibold" dir="ltr" style={{ textAlign: 'right' }}>{secret.email}</div>
            <div className="mt-2 text-sm text-muted">סיסמה זמנית</div>
            <div className="num font-display text-2xl tracking-wider" dir="ltr" style={{ textAlign: 'right' }}>{secret.password}</div>
          </div>
          <Notice>בכניסה הראשונה המערכת תבקש לבחור סיסמה אישית, ועד אז לא מוצגים שום נתונים.</Notice>
          <div className="flex gap-2">
            <Button icon="copy" onClick={() => copy(`כניסה למערכת המשך תנועה\n${window.location.origin}${window.location.pathname}#/login\nאימייל: ${secret.email}\nסיסמה זמנית: ${secret.password}`, 'פרטי הכניסה הועתקו')}>העתקת פרטי הכניסה</Button>
            <Button variant="ghost" onClick={onClose}>סגירה</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
