import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { useSettings, useStaffList } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/labels';
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
      body: 'השם, הטלפון, העיר, ההערות, יומן השיחות והמשימות יימחקו לצמיתות. נשארים רק נתונים אנונימיים (שהגיע/ה למפגש מסוים), כדי שהסטטיסטיקה של העבר לא תשתנה. אי אפשר לבטל.',
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
          ['לא נאסף בכלל', 'מידע רפואי או נפשי, יחידה צבאית או מידע מסווג, הערות על אופי ואישיות (שאלה 27 בשאלון).'],
          ['מי רואה', 'מנהלים ורכזים: הכול. צוות כניסה: רק שם ו-4 ספרות אחרונות של הטלפון, ורק ביום המפגש. ההגבלה נאכפת בשרת.'],
          ['הסכמות', `כל שינוי בהסכמה נרשם עם המקור ונוסח הטקסט (גרסה ${settings.data?.consent_text_version ?? '—'}).`],
          ['תקופת שמירה', `לוחם שלא הייתה לו פעילות ${settings.data?.retention_months ?? 36} חודשים מוצג כאן כמועמד למחיקת פרטים. שום דבר לא נמחק אוטומטית.`],
          ['בקשת מחיקה', 'לוחם/ת שמבקש/ת למחוק את הפרטים: בכרטיס הלוחם, "מחיקת פרטים אישיים".'],
        ]} />
        <div className="mt-4"><Notice tone="warn" icon="alert">מסמכי הפרטיות (מדיניות הפרטיות בעמוד ההרשמה ונוהל אבטחת המידע) מנוסחים לבדיקה משפטית ואינם הצהרת עמידה בתקנות. ראו docs/04-security-privacy.md.</Notice></div>
      </Panel>

      <Panel title="מועמדים למחיקת פרטים לפי תקופת השמירה" padded={false}>
        {candidates.isLoading ? <div className="p-5"><Skeleton lines={3} /></div> : candidates.error ? <div className="p-5"><ErrorBox error={errorMessage(candidates.error)} /></div> : !candidates.data?.length ? (
          <EmptyState icon="shield" title="אין מועמדים">אין לוחמים שעבר זמן השמירה מאז הפעילות האחרונה שלהם.</EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft">
            {candidates.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <Link to={`/app/participants/${c.id}`} className="flex-1 font-semibold hover:text-tide hover:underline">{c.full_name}</Link>
                <span className="text-sm text-muted">פעילות אחרונה: <span className="num">{fmtDate(c.last_activity)}</span></span>
                <Button size="sm" variant="danger" onClick={() => ask(c)} busy={anonymize.isPending && anonymize.variables === c.id}>מחיקת פרטים</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="גיבוי ושחזור">
        <p className="leading-relaxed text-ink-soft">
          הנתונים נשמרים ב-Supabase. בתוכנית Pro מתבצע גיבוי יומי אוטומטי שנשמר 7 ימים. בנוסף יש סקריפט לגיבוי מוצפן ידני ושחזור, והוראות מלאות ב-docs/05-operations.md.
        </p>
      </Panel>
    </div>
  );
}

type AuditRow = { id: number; at: string; actor_id: string | null; actor_role: string | null; action: string; entity: string; entity_id: string | null; changed_fields: string[] | null; details: Record<string, unknown> | null };

const ENTITY: Record<string, string> = {
  participants: 'לוחם/ת', registrations: 'הרשמה', events: 'מפגש', speakers: 'מרצה/מדריך', staff: 'משתמש', settings: 'הגדרות',
  message_templates: 'תבנית הודעה', acquisition_sources: 'מקור', referral_links: 'קישור', feedback: 'משוב', contact_log: 'יומן קשר', sites: 'מתחם',
};
const ACTION: Record<string, string> = {
  insert: 'יצירה', update: 'עדכון', delete: 'מחיקה', export: 'ייצוא', merge: 'מיזוג', anonymize: 'מחיקת פרטים',
  staff_create: 'יצירת משתמש', staff_update: 'שינוי משתמש', staff_reset_password: 'איפוס סיסמה', password_changed: 'החלפת סיסמה',
};

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
    if (!r.actor_id) return r.actor_role === 'public' ? 'לוחם/ת (טופס ציבורי)' : 'המערכת';
    return staff.data?.find((s) => s.user_id === r.actor_id)?.full_name ?? 'משתמש שנמחק';
  };
  return (
    <Panel title="יומן פעולות" padded={false} actions={
      <Select aria-label="סינון לפי סוג" value={entity} onChange={(e) => setEntity(e.target.value)} className="h-10 w-44">
        <option value="">הכול</option>
        {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
    }>
      <p className="px-5 pt-3 text-sm text-muted">מי עשה מה ומתי. היומן שומר אילו שדות השתנו, אבל לא את הערכים האישיים עצמם.</p>
      {q.isLoading ? <div className="p-5"><Skeleton lines={8} /></div> : q.error ? <div className="p-5"><ErrorBox error={errorMessage(q.error)} /></div> : (
        <>
          <ul className="divide-y divide-line-soft">
            {(q.data ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-[0.93rem] sm:px-5">
                <span className="num w-32 shrink-0 text-sm text-muted">{fmtDateTime(r.at)}</span>
                <span className="font-semibold">{who(r)}</span>
                {r.actor_role && ['admin', 'coordinator', 'volunteer'].includes(r.actor_role) && <Badge>{ROLE_LABEL[r.actor_role as Role]}</Badge>}
                <span>{ACTION[r.action] ?? r.action}</span>
                <span className="text-ink-soft">{ENTITY[r.entity] ?? r.entity}</span>
                {r.changed_fields?.length ? <span className="text-sm text-muted">({r.changed_fields.join(', ')})</span> : null}
                {r.details && <span className="num text-xs text-faint" dir="ltr">{JSON.stringify(r.details)}</span>}
              </li>
            ))}
          </ul>
          {(q.data?.length ?? 0) >= limit && <div className="p-4"><Button variant="secondary" onClick={() => setLimit(limit + 200)}>הצגת עוד</Button></div>}
        </>
      )}
    </Panel>
  );
}
