import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { staffAdmin, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useStaffList } from '@/lib/data';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/labels';
import { formatPhone, normalizePhone, whatsappLink } from '@/lib/phone';
import { firstEntryUrl } from '@/lib/links';
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
  const [ready, setReady] = useState<{ name: string; email: string | null; phone: string | null } | null>(null);
  const [phoneFor, setPhoneFor] = useState<Staff | null>(null);
  const [emailFor, setEmailFor] = useState<Staff | null>(null);
  const [invite, setInvite] = useState<{ staff: Staff; url: string } | null>(null);
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
    if (res?.temp_password) setSecret({ name: s.full_name, email: s.email ?? formatPhone(s.phone), password: res.temp_password });
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
                    <div className="num text-sm text-muted" dir="ltr" style={{ textAlign: 'right' }}>
                      {[s.phone ? formatPhone(s.phone) : null, s.email].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!s.is_active && <Badge tone="bad">חסום</Badge>}
                    {!s.must_change_password && <Badge tone="tide">כניסה בקוד</Badge>}
                    {s.is_active && s.must_change_password && <Badge tone="warn">ממתין לבחירת סיסמה</Badge>}
                    <Select aria-label={`תפקיד של ${s.full_name}`} value={s.role} disabled={self || busy === s.user_id} className="h-10 w-40"
                      onChange={(e) => run(s.user_id, { action: 'update', user_id: s.user_id, role: e.target.value }, 'התפקיד עודכן')}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                    {!self && s.is_active && (
                      <Button size="sm" variant="secondary" disabled={busy === s.user_id}
                        onClick={async () => { const r = await run(s.user_id, { action: 'invite', user_id: s.user_id }, 'נוצר קישור כניסה ראשונה'); if (r && 'token' in r) setInvite({ staff: s, url: firstEntryUrl(String((r as { token: string }).token)) }); }}>
                        קישור כניסה ראשונה
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setEmailFor(s)} disabled={busy === s.user_id}>{s.email ? 'שינוי אימייל' : 'הוספת אימייל'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setPhoneFor(s)} disabled={busy === s.user_id}>{s.phone ? 'שינוי טלפון' : 'הוספת טלפון'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => reset(s)} disabled={busy === s.user_id}>{s.must_change_password ? 'איפוס סיסמה' : 'סיסמה זמנית'}</Button>
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

      <CreateUser
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(r) => {
          setCreating(false);
          refresh();
          if (r.password && r.email) setSecret({ name: r.name, email: r.email, password: r.password });
          else setReady({ name: r.name, email: r.email, phone: r.phone });
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <CodeReadyDialog ready={ready} onClose={() => setReady(null)} />
      <InviteDialog invite={invite} onClose={() => setInvite(null)} />
      {emailFor && (
        <EmailDialog
          staff={emailFor}
          onClose={() => setEmailFor(null)}
          onSave={async (email) => {
            const ok = await run(emailFor.user_id, { action: 'update', user_id: emailFor.user_id, email }, email ? 'האימייל נשמר: הכניסה בקוד למייל' : 'האימייל הוסר');
            if (ok) setEmailFor(null);
          }}
        />
      )}
      {phoneFor && (
        <PhoneDialog
          staff={phoneFor}
          onClose={() => setPhoneFor(null)}
          onSave={async (phone) => {
            const ok = await run(phoneFor.user_id, { action: 'update', user_id: phoneFor.user_id, phone }, phone ? 'הטלפון נשמר: אפשר להיכנס גם בקוד SMS' : 'הטלפון הוסר');
            if (ok) setPhoneFor(null);
          }}
        />
      )}
    </div>
  );
}

type Created = { name: string; email: string | null; phone: string | null; password: string | null };

function CreateUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: Created) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError('צריך שם מלא.');
    const p = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !(p && /^\+9725\d{8}$/.test(p))) return setError('צריך מספר טלפון נייד, למשל 050-1234567.');
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError('כתובת האימייל לא תקינה.');
    if (!p && !email.trim()) return setError('צריך אימייל (לכניסה בקוד למייל) או טלפון נייד.');
    if (!role) return setError('צריך לבחור תפקיד.');
    setBusy(true);
    try {
      const res = await staffAdmin<{ temp_password: string | null }>({ action: 'create', full_name: name.trim(), email: email.trim() || undefined, phone: p ?? undefined, role });
      onCreated({ name: name.trim(), email: email.trim() || null, phone: p, password: res.temp_password });
      setName(''); setPhone(''); setEmail(''); setRole('');
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
        <Input label="אימייל (לכניסה בקוד למייל)" type="email" ltr value={email} onChange={(e) => setEmail(e.target.value)} hint="נכנסים עם קוד חד־פעמי שנשלח למייל, בלי סיסמה." />
        <Input label="טלפון נייד (לא חובה)" type="tel" inputMode="tel" ltr className="num" placeholder="050-1234567" value={phone} onChange={(e) => setPhone(e.target.value)} hint="לכניסה בקוד SMS, כשיחובר שירות SMS." />
        <ChoiceGroup<Role> legend="תפקיד" required columns={1} value={role} onChange={setRole}
          options={ROLES.map((r) => ({ value: r, label: <span>{ROLE_LABEL[r]} <span className="block text-sm font-normal text-muted">{ROLE_HINT[r]}</span></span> }))} />
        {error && <ErrorBox error={error} />}
        <div className="flex gap-2"><Button type="submit" busy={busy}>יצירת המשתמש</Button><Button variant="ghost" onClick={onClose}>ביטול</Button></div>
      </form>
    </Dialog>
  );
}

/** The account signs in with a one-time code: nothing secret to hand over, just how to get in. */
function CodeReadyDialog({ ready, onClose }: { ready: { name: string; email: string | null; phone: string | null } | null; onClose: () => void }) {
  const copy = useCopy();
  const link = `${window.location.origin}${window.location.pathname}#/login`;
  const how = ready?.email ? 'מקלידים את כתובת האימייל שלך ומקבלים קוד למייל.' : 'מקלידים את מספר הטלפון שלך ומקבלים קוד ב-SMS.';
  return (
    <Dialog open={!!ready} onClose={onClose} title="המשתמש נוצר" size="sm">
      {ready && (
        <div className="flex flex-col gap-4">
          <p>
            <span className="font-semibold">{ready.name}</span> נכנס/ת עם קוד חד־פעמי{' '}
            {ready.email ? <>למייל <span className="num font-semibold" dir="ltr">{ready.email}</span></> : <>ב-SMS לטלפון <span className="num font-semibold" dir="ltr">{formatPhone(ready.phone)}</span></>}. אין סיסמה.
          </p>
          <div className="flex gap-2">
            <Button icon="copy" onClick={() => copy(`כניסה למערכת המשך תנועה\n${link}\n${how}`, 'ההוראות הועתקו')}>העתקת הוראות הכניסה</Button>
            <Button variant="ghost" onClick={onClose}>סגירה</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** A one-time first-entry link: the person opens it, types their own email, and is in. */
function InviteDialog({ invite, onClose }: { invite: { staff: Staff; url: string } | null; onClose: () => void }) {
  const copy = useCopy();
  const text = invite ? `היי ${invite.staff.full_name.split(' ')[0]}, זה הקישור האישי שלך לכניסה הראשונה למערכת של המשך תנועה. כותבים בו את האימייל שלך ונכנסים:\n${invite.url}` : '';
  return (
    <Dialog open={!!invite} onClose={onClose} title="קישור כניסה ראשונה" size="sm">
      {invite && (
        <div className="flex flex-col gap-4">
          <p>שלחו ל<span className="font-semibold">{invite.staff.full_name}</span> את הקישור באופן אישי. הוא עובד פעם אחת ותקף 7 ימים. הקישור מוצג עכשיו בלבד.</p>
          <code dir="ltr" className="num block break-all rounded-[var(--radius-control)] bg-mist p-3 text-sm">{invite.url}</code>
          <div className="flex flex-wrap gap-2">
            {invite.staff.phone && (
              <a href={whatsappLink(invite.staff.phone, text)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center rounded-full bg-tide px-5 font-semibold text-mist">שליחה בוואטסאפ</a>
            )}
            <Button variant="secondary" icon="copy" onClick={() => copy(text, 'ההודעה הועתקה')}>העתקה</Button>
            <Button variant="ghost" onClick={onClose}>סגירה</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function EmailDialog({ staff, onClose, onSave }: { staff: Staff; onClose: () => void; onSave: (email: string | null) => Promise<void> }) {
  const [email, setEmail] = useState(staff.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return setError('כתובת האימייל לא תקינה.');
    if (!v && !staff.phone) return setError('בלי אימייל ובלי טלפון לא יהיה איך להיכנס.');
    setBusy(true);
    await onSave(v || null);
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={`אימייל לכניסה: ${staff.full_name}`} size="sm">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Input label="אימייל" type="email" ltr value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
        <p className="text-sm text-muted">הקוד לכניסה נשלח לכתובת הזו.</p>
        {error && <ErrorBox error={error} />}
        <div className="flex gap-2"><Button type="submit" busy={busy}>שמירה</Button><Button variant="ghost" onClick={onClose}>ביטול</Button></div>
      </form>
    </Dialog>
  );
}

function PhoneDialog({ staff, onClose, onSave }: { staff: Staff; onClose: () => void; onSave: (phone: string | null) => Promise<void> }) {
  const [phone, setPhone] = useState(formatPhone(staff.phone));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const p = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !(p && /^\+9725\d{8}$/.test(p))) return setError('צריך מספר טלפון נייד, למשל 050-1234567.');
    if (!p && !staff.email) return setError('בלי טלפון ובלי אימייל לא יהיה איך להיכנס.');
    setBusy(true);
    await onSave(p);
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={`טלפון לכניסה: ${staff.full_name}`} size="sm">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Input label="טלפון נייד" type="tel" inputMode="tel" ltr className="num" placeholder="050-1234567" value={phone} onChange={(e) => { setPhone(e.target.value); setError(null); }} />
        <p className="text-sm text-muted">הקוד לכניסה נשלח ב-SMS למספר הזה. {staff.email ? 'אפשר להשאיר ריק כדי לחזור לכניסה עם סיסמה.' : ''}</p>
        {error && <ErrorBox error={error} />}
        <div className="flex gap-2"><Button type="submit" busy={busy}>שמירה</Button><Button variant="ghost" onClick={onClose}>ביטול</Button></div>
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
            <div className="text-sm text-muted">שם משתמש (טלפון או אימייל)</div>
            <div className="num font-semibold" dir="ltr" style={{ textAlign: 'right' }}>{secret.email}</div>
            <div className="mt-2 text-sm text-muted">סיסמה זמנית</div>
            <div className="num font-display text-2xl tracking-wider" dir="ltr" style={{ textAlign: 'right' }}>{secret.password}</div>
          </div>
          <Notice>בכניסה הראשונה המערכת תבקש לבחור סיסמה אישית, ועד אז לא מוצגים שום נתונים.</Notice>
          <div className="flex gap-2">
            <Button icon="copy" onClick={() => copy(`כניסה למערכת המשך תנועה\n${window.location.origin}${window.location.pathname}#/login\nשם משתמש: ${secret.email}\nסיסמה זמנית: ${secret.password}\nבכניסה: "כניסה עם טלפון או אימייל וסיסמה"`, 'פרטי הכניסה הועתקו')}>העתקת פרטי הכניסה</Button>
            <Button variant="ghost" onClick={onClose}>סגירה</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
