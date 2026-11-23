import { useQuery } from '@tanstack/react-query';
import { fmtListDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { ROLE_LABEL } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Role } from '@/lib/types';
import { Badge, ErrorBox, Notice, Panel, Skeleton } from '@/ui/kit';

export type SecurityOverview = {
  unknown_accounts: { created_at: string; email: string | null; phone: string | null }[];
  limits_24h: { staff_phone_locked: number; staff_ip_blocked: number; invite_probing: number; door_name_guessing: number; form_flooding: number };
  staff: { user_id: string; full_name: string; role: Role; is_active: boolean; mfa: boolean; last_sign_in_at: string | null }[];
  recent: { at: string; action: string; actor: string | null; target: string | null }[];
};

export function useSecurityOverview(enabled = true) {
  return useQuery({
    queryKey: ['security_overview'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SecurityOverview> => {
      const { data, error } = await supabase.rpc('admin_security_overview');
      if (error) throw error;
      return data as SecurityOverview;
    },
  });
}

/** Number of things an admin should look at now (for the dashboard alert). */
export const securityAlerts = (s: SecurityOverview | undefined) =>
  !s ? 0 : s.unknown_accounts.length + s.limits_24h.staff_phone_locked + s.limits_24h.invite_probing;

const LIMITS: { key: keyof SecurityOverview['limits_24h']; label: string; hint: string }[] = [
  { key: 'staff_phone_locked', label: 'כניסת צוות: טלפון נחסם', hint: '8 ניסיונות סיסמה שגויים לאותו טלפון ברבע שעה' },
  { key: 'staff_ip_blocked', label: 'כניסת צוות: כתובת נחסמה', hint: '30 ניסיונות מאותה כתובת ברבע שעה' },
  { key: 'invite_probing', label: 'קישורי כניסה ראשונה', hint: 'ניחוש או ניסיונות חוזרים על קישור' },
  { key: 'door_name_guessing', label: 'ניחוש שם בכניסה למפגש', hint: '5 ניסיונות שם לאותו טלפון ביום' },
  { key: 'form_flooding', label: 'הצפת טפסים ציבוריים', hint: 'הרשמה, צ׳ק־אין או משוב מעבר למגבלה' },
];

const ACTION_LABEL: Record<string, string> = {
  staff_create: 'נוצר משתמש',
  staff_update: 'עודכן משתמש (תפקיד, חסימה או פרטים)',
  staff_reset_password: 'סיסמה זמנית',
  staff_invite: 'קישור כניסה ראשונה',
  staff_first_entry: 'כניסה ראשונה בקישור',
  password_changed: 'החלפת סיסמה',
  mfa_reset: 'איפוס אימות דו־שלבי',
  site_code_rotated: 'הוחלף קוד השלט',
  anonymize: 'מחיקת פרטים אישיים',
  export: 'ייצוא נתונים',
  go_live: 'מעבר למערכת אמיתית',
  insert: 'נוסף איש צוות',
  update: 'שינוי בפרטי איש צוות',
  delete: 'נמחק איש צוות',
};

export function SecuritySettings() {
  const q = useSecurityOverview();
  if (q.isLoading) return <Skeleton shape="tiles" count={3} height={200} cols="grid-cols-1" />;
  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const noMfa = s.staff.filter((m) => m.is_active && !m.mfa);
  return (
    <div className="flex flex-col gap-5">
      {s.unknown_accounts.length > 0 ? (
        <Panel title="חשבונות שאינם אנשי צוות">
          <Notice tone="warn" icon="alert">
            מישהו נרשם לשירות האימות בלי להיות איש צוות. לחשבונות כאלה אין גישה לשום מידע, אבל כדאי לסגור את ההרשמה העצמית: בלוח הבקרה של Supabase, Authentication ← Sign In / Providers ← לכבות "Allow new users to sign up".
          </Notice>
          <ul className="mt-3 divide-y divide-edge">
            {s.unknown_accounts.map((u, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2 text-body">
                <span className="num" dir="ltr">{u.email ?? u.phone ?? 'בלי פרטים'}</span>
                <span className="tabular-nums text-muted">{fmtListDate(u.created_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Notice tone="light" icon="checkCircle">כל החשבונות במערכת שייכים לאנשי צוות.</Notice>
      )}

      <Panel title="חסימות ב־24 השעות האחרונות">
        <ul className="divide-y divide-edge">
          {LIMITS.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="font-semibold">{l.label}</div>
                <div className="text-small text-muted">{l.hint}</div>
              </div>
              <Badge tone={s.limits_24h[l.key] > 0 ? 'warn' : 'neutral'} icon={s.limits_24h[l.key] > 0 ? 'alert' : undefined}><span className="num">{s.limits_24h[l.key]}</span></Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-small text-muted">מספר גבוה בשורה של כניסת צוות או קישורי כניסה הוא סימן לניסיון פריצה. החסימות משתחררות לבד.</p>
      </Panel>

      <Panel title="אימות דו־שלבי לאנשי הצוות">
        {noMfa.length > 0 && <div className="mb-3"><Notice>מומלץ שכל המנהלים יפעילו אימות דו־שלבי ב"החשבון שלי".</Notice></div>}
        <ul className="divide-y divide-edge">
          {s.staff.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <span className="font-semibold">{m.full_name}</span>
                <span className="ms-2 text-small text-muted">{ROLE_LABEL[m.role]}{!m.is_active ? ' · חשבון חסום' : ''}</span>
                <div className="text-small text-muted">כניסה אחרונה: {m.last_sign_in_at ? <span className="tabular-nums">{fmtListDate(m.last_sign_in_at)}</span> : 'עוד לא הייתה כניסה'}</div>
              </div>
              {m.mfa ? <Badge tone="good" icon="check">אימות דו־שלבי</Badge> : <Badge>סיסמה בלבד</Badge>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="שינויים בהרשאות, 30 הימים האחרונים">
        {s.recent.length === 0 ? (
          <p className="text-muted">אין שינויים.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {s.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2 text-body">
                <span>{ACTION_LABEL[r.action] ?? r.action}{r.target ? `: ${r.target}` : ''}{r.actor ? <span className="text-muted"> (על ידי {r.actor})</span> : null}</span>
                <span className="tabular-nums text-muted">{fmtListDate(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
