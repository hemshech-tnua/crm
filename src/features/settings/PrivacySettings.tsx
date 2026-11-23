import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtDate, fmtListDate } from '@/lib/dates';
import { useSettings, useStaffList } from '@/lib/data';
import { EVENT_STATUS_LABEL, PAYMENT_STATUS_LABEL, REG_STATUS_LABEL, ROLE_LABEL } from '@/lib/labels';
import { STATUS_LABEL as SHIFT_STATUS_LABEL } from '@/features/volunteers/model';
import type { Role } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, KeyValue, Notice, Panel, Select, Skeleton } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';

type Candidate = { id: string; full_name: string; city: string | null; last_activity: string };

export function PrivacySettings() {
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const candidates = useQuery({
    queryKey: ['retention'],
    queryFn: async () => must(await supabase.rpc('admin_retention_candidates')) as Candidate[],
  });
  const anonymize = useMutation({
    mutationFn: async (id: string) => must(await supabase.rpc('admin_anonymize_participant', { p_id: id })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['retention'] }); qc.invalidateQueries({ queryKey: ['participants'] }); toast.success('הפרטים האישיים נמחקו'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ask = async (c: Candidate) => {
    const ok = await confirm({
      title: `מחיקת הפרטים של ${c.full_name}`,
      body: 'השם, הטלפון, העיר, ההערות, יומן השיחות והמשימות יימחקו לצמיתות. נשארים רק נתונים אנונימיים (הגעה למפגש מסוים), כדי שהסטטיסטיקה של העבר לא תשתנה. אי אפשר לבטל.',
      confirm: 'מחיקת הפרטים',
      danger: true,
    });
    if (ok) anonymize.mutate(c.id);
  };
  return (
    <div className="flex flex-col gap-5">
      <Panel title="מה נשמר ואיך">
        <KeyValue items={[
          ['נאסף בהרשמה', 'שם, טלפון, עיר, גיל (נשמר כשנת לידה משוערת), איך שמעו עלינו, ומי הביא. הסכמה לעדכונים ובקשה לא להצטלם הן רשות.'],
          ['לא נאסף בכלל', 'מידע רפואי או נפשי, יחידה צבאית או מידע מסווג, הערות על אופי ואישיות.'],
          ['מי רואה', 'מנהלים ורכזים: הכול. צוות כניסה: רק שם ו־4 ספרות אחרונות של הטלפון, ורק ביום המפגש. ההגבלה נאכפת בשרת.'],
          ['הסכמות', `כל שינוי בהסכמה נרשם עם המקור ונוסח הטקסט (גרסה ${settings.data?.consent_text_version ?? '—'}).`],
          ['תקופת שמירה', `לוחם שלא הייתה לו פעילות ${settings.data?.retention_months ?? 36} חודשים מוצג כאן כמועמד למחיקת פרטים. שום דבר לא נמחק אוטומטית.`],
          ['בקשת מחיקה', 'מי שמבקש למחוק את הפרטים: בכרטיס הלוחם, "מחיקת פרטים אישיים".'],
        ]} />
        <div className="mt-4"><Notice tone="warn" icon="alert">מסמכי הפרטיות (מדיניות הפרטיות בעמוד ההרשמה ונוהל אבטחת המידע) מנוסחים לבדיקה משפטית ואינם הצהרת עמידה בתקנות. המסמך המלא נמצא בתיעוד המערכת.</Notice></div>
      </Panel>

      <Panel title="מועמדים למחיקת פרטים לפי תקופת השמירה" padded={false}>
        {candidates.isLoading ? <div className="p-5"><Skeleton lines={3} /></div> : candidates.error && !candidates.data ? <div className="p-5"><ErrorBox error={errorMessage(candidates.error)} onRetry={() => void candidates.refetch()} /></div> : !candidates.data?.length ? (
          <EmptyState icon="shield" title="אין מועמדים">אין לוחמים שעבר זמן השמירה מאז הפעילות האחרונה שלהם.</EmptyState>
        ) : (
          <ul className="divide-y divide-edge">
            {candidates.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <Link to={`/app/participants/${c.id}`} className="flex-1 font-semibold hover:text-tide hover:underline">{c.full_name}</Link>
                <span className="text-small text-muted">פעילות אחרונה: <span className="num">{fmtDate(c.last_activity)}</span></span>
                <Button size="sm" variant="danger" onClick={() => ask(c)} busy={anonymize.isPending && anonymize.variables === c.id}>מחיקת פרטים</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="גיבוי ושחזור">
        <p className="leading-relaxed text-ink-soft">
          הנתונים נשמרים ב־Supabase. בתוכנית Pro מתבצע גיבוי יומי אוטומטי שנשמר 7 ימים. בנוסף יש סקריפט לגיבוי מוצפן ידני ושחזור. ההוראות המלאות נמצאות בתיעוד המערכת.
        </p>
      </Panel>
    </div>
  );
}

type AuditRow = { id: number; at: string; actor_id: string | null; actor_role: string | null; action: string; entity: string; entity_id: string | null; changed_fields: string[] | null; details: Record<string, unknown> | null };

// ───────────── the audit log as sentences ─────────────
// Each row reads as "what happened" (a sentence built from the entity, the action and the changed fields), then who
// and when. The raw record stays one tap away under "פרטים טכניים", so nothing the log keeps is hidden.

/** The thing a row is about: its name and grammatical gender (for "נוצר" / "נוצרה"). */
const ENTITY: Record<string, { name: string; f?: boolean; filter?: string }> = {
  participants: { name: 'כרטיס', filter: 'כרטיסי לוחמים' },
  registrations: { name: 'הרשמה', f: true, filter: 'הרשמות' },
  events: { name: 'מפגש', filter: 'מפגשים' },
  speakers: { name: 'כרטיס מרצה או מדריך', filter: 'מרצים ומדריכים' },
  staff: { name: 'משתמש', filter: 'משתמשים' },
  settings: { name: 'ההגדרות', filter: 'הגדרות' },
  message_templates: { name: 'תבנית הודעה', f: true, filter: 'תבניות הודעה' },
  acquisition_sources: { name: 'מקור הגעה', filter: 'מקורות הגעה' },
  referral_links: { name: 'קישור הרשמה', filter: 'קישורי הרשמה' },
  feedback: { name: 'משוב', filter: 'משובים' },
  contact_log: { name: 'תיעוד שיחה', filter: 'תיעוד שיחות' },
  sites: { name: 'מתחם', filter: 'מתחמים' },
  volunteers: { name: 'כרטיס מתנדב', filter: 'מתנדבים' },
  volunteer_shifts: { name: 'שיבוץ מתנדב', filter: 'שיבוצי מתנדבים' },
  event_payments: { name: 'תשלום לספק', filter: 'תשלומים לספקים' },
  suppliers: { name: 'ספק', filter: 'ספקים' },
  unmatched_payments: { name: 'תשלום שמחכה להתאמה', filter: 'תשלומים להתאמה' },
  finance: { name: 'דוח הכספים', filter: 'כספים' },
};

const VERB: Record<string, [string, string]> = {
  insert: ['נוצר', 'נוצרה'],
  update: ['עודכן', 'עודכנה'],
  delete: ['נמחק', 'נמחקה'],
};

/** Actions that are a sentence of their own. */
const SPECIAL: Record<string, string> = {
  merge: 'שני כרטיסים מוזגו לכרטיס אחד',
  anonymize: 'הפרטים האישיים בכרטיס נמחקו (התממה)',
  export: 'ייצוא נתונים',
  checkin_undo: 'סימון ההגעה הוסר',
  membership_request: 'נשלחה בקשת הצטרפות לעמותה',
  personal_link: 'הרשמה בקישור אישי',
  volunteer_link: 'נוצר קישור אישי למתנדב',
  staff_create: 'נוצר משתמש חדש',
  staff_update: 'פרטי משתמש עודכנו',
  staff_reset_password: 'נוצרה סיסמה זמנית',
  staff_invite: 'נוצר קישור כניסה ראשונה',
  staff_first_entry: 'כניסה ראשונה בקישור',
  password_changed: 'הסיסמה הוחלפה',
  mfa_reset: 'האימות הדו־שלבי אופס',
  site_code_rotated: 'קוד השלט של המתחם הוחלף',
  go_live: 'מעבר למערכת אמיתית',
  label: 'השם שונה',
};

const FIELD: Record<string, string> = {
  attendance: 'הגעה', checked_in_at: 'שעת הכניסה', checkin_method: 'דרך הסימון', checked_in_by: 'מי סימן',
  manage_token_hash: 'קישור לניהול ההרשמה', status: 'סטטוס', payment_status: 'מצב התשלום', payment_method: 'אמצעי התשלום',
  paid_at: 'מועד התשלום', paid_amount: 'סכום ששולם', payment_ref: 'אסמכתה', cancelled_by: 'ביטול', cancelled_at: 'ביטול',
  cancel_reason: 'סיבת הביטול', promoted_at: 'עלייה מרשימת ההמתנה', submitted_name: 'השם שנמסר', participant_id: 'הכרטיס',
  registered_at: 'מועד ההרשמה', is_walk_in: 'הגעה בלי הרשמה', completed_at: 'סגירת המפגש', price: 'מחיר', starts_at: 'מועד',
  ends_at: 'שעת הסיום', payment_url: 'קישור לתשלום', lecture_description: 'תיאור ההרצאה', speaker_id: 'מרצה',
  instructor_id: 'מדריך', lecture_topic: 'נושא ההרצאה', body: 'נוסח', membership: 'חברות בעמותה',
  membership_requested_at: 'בקשת הצטרפות', member_since: 'חברות מתאריך', city: 'עיר', notes: 'הערות', occupation: 'עיסוק',
  full_name: 'שם', phone: 'טלפון', anonymized_at: 'התממה', consent_updates: 'הסכמה לעדכונים', consent_updates_at: 'הסכמה לעדכונים',
  contact_phone: 'טלפון הצוות', checkin_code: 'קוד צ׳ק־אין', is_active: 'פעיל', photo_path: 'תמונה', approved_at: 'אישור',
  approved_by: 'אישור', about: 'כמה מילים', role_label: 'תיאור תפקיד', must_change_password: 'החלפת סיסמה בכניסה',
  email: 'אימייל', role: 'תפקיד', resolved_at: 'טיפול', resolved_by: 'טיפול', registration_id: 'התאמה להרשמה', note: 'הערה',
  responded_at: 'תשובה', link_token_hash: 'קישור אישי', paid_on: 'תאריך התשלום', invoice_received: 'חשבונית', label: 'שם',
  capacity: 'מספר מקומות', title: 'שם המפגש', location: 'מקום',
};

/** A few values worth reading in words (the rest stay in "פרטים טכניים"). */
const VALUE: Record<string, Record<string, string>> = {
  attendance: { attended: 'סומנה הגעה', no_show: 'סומנה אי־הגעה', unknown: 'הסימון הוסר' },
  payment_status: PAYMENT_STATUS_LABEL,
  role: { admin: ROLE_LABEL.admin, coordinator: ROLE_LABEL.coordinator, volunteer: ROLE_LABEL.volunteer },
};
const STATUS_VALUE: Record<string, Record<string, string>> = {
  registrations: REG_STATUS_LABEL,
  events: EVENT_STATUS_LABEL,
  speakers: { approved: 'מאושר', proposed: 'מחכה לאישור', declined: 'נדחה', archived: 'בארכיון' },
  volunteer_shifts: SHIFT_STATUS_LABEL,
  unmatched_payments: { open: 'מחכה להתאמה', attached: 'הותאם להרשמה', ignored: 'לא קשור' },
};

function sentence(r: AuditRow): { text: string; extra: string | null } {
  const e = ENTITY[r.entity];
  const d = r.details ?? {};
  const said = (k: string): string | null => {
    const v = d[k];
    if (v == null || typeof v === 'object') return null;
    const m = k === 'status' ? STATUS_VALUE[r.entity] : VALUE[k];
    if (m?.[String(v)]) return m[String(v)];
    if (typeof v === 'boolean') return v ? 'כן' : 'לא';
    return null;
  };
  if (r.action === 'export') {
    const rows = typeof d.rows === 'number' ? d.rows : null;
    return { text: `ייצוא ${e?.filter ?? 'נתונים'}${rows != null ? ` (${rows.toLocaleString('he-IL')} שורות)` : ''}`, extra: null };
  }
  if (r.action === 'merge') {
    const n = typeof d.registrations === 'number' ? d.registrations : null;
    return { text: SPECIAL.merge, extra: n != null ? `${n} הרשמות עברו לכרטיס שנשאר` : null };
  }
  if (r.action === 'staff_create' || r.action === 'staff_update') {
    const parts = [said('role') ? `תפקיד: ${said('role')}` : null, d.is_active === false ? 'חשבון חסום' : null,
      d.email_changed ? 'האימייל שונה' : null, d.phone_changed ? 'הטלפון שונה' : null].filter(Boolean);
    return { text: SPECIAL[r.action], extra: parts.join(' · ') || null };
  }
  if (SPECIAL[r.action] && !VERB[r.action]) return { text: SPECIAL[r.action], extra: null };
  const name = e?.name ?? r.entity;
  const verb = VERB[r.action]?.[e?.f ? 1 : 0] ?? r.action;
  const fields = [...new Set((r.changed_fields ?? []).map((f) => FIELD[f] ?? f))];
  const values = Object.keys(d).map((k) => (said(k) && (r.action !== 'insert' || k === 'status') ? `${FIELD[k] ?? k}: ${said(k)}` : null)).filter(Boolean);
  if (r.action === 'update' && fields.length) return { text: `${name} ${verb}: ${fields.join(', ')}`, extra: values.join(' · ') || null };
  return { text: `${name} ${verb}`, extra: values.join(' · ') || null };
}

/** Where the row leads: the card or the meeting it is about. */
function target(r: AuditRow): { to: string; label: string } | null {
  const d = r.details ?? {};
  if (r.entity === 'participants' && r.entity_id && r.action !== 'delete' && r.action !== 'anonymize') return { to: `/app/participants/${r.entity_id}`, label: 'לכרטיס' };
  if (r.entity === 'events' && r.entity_id && r.action !== 'delete') return { to: `/app/events/${r.entity_id}`, label: 'למפגש' };
  if (typeof d.event_id === 'string') return { to: `/app/events/${d.event_id}`, label: 'למפגש' };
  return null;
}

export function AuditLog() {
  const staff = useStaffList();
  const [entity, setEntity] = useState('');
  const [limit, setLimit] = useState(100);
  const q = useQuery({
    queryKey: ['audit', entity, limit],
    queryFn: async () => {
      let query = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(limit);
      if (entity) query = query.eq('entity', entity);
      return must(await query) as AuditRow[];
    },
  });
  const who = (r: AuditRow) => {
    if (!r.actor_id) return r.actor_role === 'public' ? 'טופס ציבורי' : 'המערכת';
    return staff.data?.find((s) => s.user_id === r.actor_id)?.full_name ?? 'משתמש שנמחק';
  };
  return (
    <Panel title="יומן פעולות" padded={false} actions={
      <Select aria-label="סינון לפי סוג" value={entity} onChange={(e) => setEntity(e.target.value)} className="h-10 w-48">
        <option value="">כל הסוגים</option>
        {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v.filter ?? v.name}</option>)}
      </Select>
    }>
      <p className="px-4 pt-3 text-small text-muted sm:px-5">מי עשה מה ומתי. היומן שומר אילו שדות השתנו, אבל לא את הערכים האישיים עצמם.</p>
      {q.isLoading ? <div className="p-5"><Skeleton lines={8} /></div> : q.error && !q.data ? <div className="p-5"><ErrorBox error={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div> : !q.data?.length ? (
        <EmptyState icon="search" title="אין פעולות מהסוג הזה" />
      ) : (
        <>
          <ul className="mt-2 divide-y divide-edge" data-testid="audit-log">
            {q.data.map((r) => {
              const { text, extra } = sentence(r);
              const link = target(r);
              const tech = [r.changed_fields?.length ? r.changed_fields.join(', ') : null, r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : null].filter(Boolean);
              return (
                <li key={r.id} className="flex flex-col px-4 py-2 text-body sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p><span className="font-semibold text-ink">{text}</span>{extra && <span className="text-small text-ink-soft"> · {extra}</span>}</p>
                    <span className="tabular-nums shrink-0 text-small text-muted">{fmtListDate(r.at)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
                    <span>{who(r)}</span>
                    {r.actor_role && ['admin', 'coordinator', 'volunteer'].includes(r.actor_role) && <Badge>{ROLE_LABEL[r.actor_role as Role]}</Badge>}
                    {link && <Link to={link.to} className="inline-flex min-h-8 items-center font-semibold text-tide hover:underline pointer-coarse:min-h-11">{link.label}</Link>}
                    {tech.length > 0 && (
                      <details className="group open:basis-full">
                        <summary className="inline-flex min-h-8 cursor-pointer items-center text-faint hover:text-ink pointer-coarse:min-h-11">פרטים טכניים</summary>
                        <span className="num block break-all text-micro text-faint" dir="ltr">{tech.join(' · ')}</span>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {(q.data?.length ?? 0) >= limit && <div className="p-4"><Button variant="secondary" onClick={() => setLimit(limit + 200)}>הצגת עוד</Button></div>}
        </>
      )}
    </Panel>
  );
}
