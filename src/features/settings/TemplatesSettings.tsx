import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useTemplates } from '@/lib/data';
import { PLACEHOLDERS, renderTemplate, unknownPlaceholders } from '@/lib/templates';
import { addDays, fromIl, nextFriday, todayIl } from '@/lib/dates';
import type { Template } from '@/lib/types';
import { Badge, Button, Checkbox, ErrorBox, Input, Notice, Panel, Skeleton, Textarea } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';

const AUDIENCE: Record<Template['audience'], string> = {
  registered: 'למי שרשום למפגש',
  waitlisted: 'למי שברשימת ההמתנה',
  attended: 'למי שהגיע',
  no_show: 'למי שנרשם ולא הגיע',
  consented: 'למי שהסכים לקבל עדכונים',
  participant: 'ללוחם/ת מסוים/ת',
};

const SAMPLE = {
  firstName: 'נועה', eventTitle: 'מפגש שישי', startsAt: fromIl(nextFriday(addDays(todayIl(), 1)), '09:00'), location: 'הולמס פלייס מודיעין',
  activity: 'יוגה', speaker: 'רונן לוי', topic: 'חוסן בחזרה לשגרה', registerLink: 'https://…/#/r/abc', feedbackLink: 'https://…/#/f/abc',
};

export function TemplatesSettings() {
  const templates = useTemplates();
  const [editing, setEditing] = useState<Template | null>(null);
  if (templates.isLoading) return <Skeleton lines={6} />;
  if (templates.error) return <ErrorBox error={errorMessage(templates.error)} />;
  return (
    <>
      <div className="mb-4"><Notice>ההודעות לא נשלחות לבד. בכל מקום במערכת לוחצים "פתיחה בוואטסאפ", הטקסט מוכן, ושולחים מהטלפון. הודעות שמסומנות "דורש הסכמה" נפתחות רק ללוחמים שאישרו קבלת עדכונים (חוק התקשורת, סעיף 30א).</Notice></div>
      <div className="grid gap-4 md:grid-cols-2">
        {(templates.data ?? []).map((t) => (
          <Panel key={t.key} title={t.label} actions={<Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(t)}>עריכה</Button>}>
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge>{AUDIENCE[t.audience]}</Badge>
              {t.is_marketing ? <Badge tone="warn">דורש הסכמה</Badge> : <Badge tone="tide">הודעת שירות</Badge>}
            </div>
            <p className="whitespace-pre-line text-[0.95rem] leading-relaxed text-ink-soft">{renderTemplate(t.body, SAMPLE)}</p>
          </Panel>
        ))}
      </div>
      <EditTemplate t={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function EditTemplate({ t, onClose }: { t: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  if (t && key !== t.key) {
    setKey(t.key);
    setLabel(t.label);
    setBody(t.body);
    setMarketing(t.is_marketing);
  }
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('message_templates').update({ label: label.trim(), body, is_marketing: marketing }).eq('key', t!.key);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('ההודעה נשמרה'); setKey(null); onClose(); },
  });
  const insert = (k: string) => {
    const el = ref.current;
    const token = `{${k}}`;
    if (!el) return setBody(body + token);
    const s = el.selectionStart ?? body.length;
    const next = body.slice(0, s) + token + body.slice(el.selectionEnd ?? s);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };
  const unknown = unknownPlaceholders(body);
  return (
    <Dialog open={!!t} onClose={() => { setKey(null); onClose(); }} title="עריכת הודעה" size="lg"
      footer={<><Button busy={save.isPending} disabled={!label.trim() || body.trim().length < 2 || unknown.length > 0} onClick={() => save.mutate()}>שמירה</Button><Button variant="ghost" onClick={() => { setKey(null); onClose(); }}>ביטול</Button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Input label="שם ההודעה" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Textarea ref={ref} label="הטקסט" value={body} onChange={(e) => setBody(e.target.value)} rows={8} error={unknown.length ? `לא מוכר: ${unknown.map((u) => `{${u}}`).join(', ')}` : null} />
          <div>
            <div className="mb-1.5 text-sm font-semibold">הוספת פרט שמתמלא לבד</div>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => (
                <button key={p.key} type="button" title={p.label} onClick={() => insert(p.key)} className="rounded-full border border-line bg-paper px-2.5 py-1 text-sm hover:border-tide hover:text-tide">{p.label}</button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">שורה שיש בה פרט חסר (למשל עוד אין מרצה) לא תופיע בהודעה.</p>
          </div>
          <Checkbox checked={marketing} onChange={setMarketing} label="הודעה שיווקית: נשלחת רק למי שהסכים לקבל עדכונים" hint="הזמנות למפגשים, הודעות לאחר תקופה בלי הגעה. אישור הרשמה ותזכורת למפגש שנרשמו אליו הן הודעות שירות." />
          {save.error && <ErrorBox error={errorMessage(save.error)} />}
        </div>
        <div>
          <div className="mb-1.5 text-sm font-semibold">איך זה ייראה (דוגמה)</div>
          <div className="rounded-2xl rounded-tl-sm bg-[#dcf8c6] p-4 whitespace-pre-line text-[0.95rem] leading-relaxed text-[#111b21] shadow-sm">{renderTemplate(body, SAMPLE) || '—'}</div>
        </div>
      </div>
    </Dialog>
  );
}
