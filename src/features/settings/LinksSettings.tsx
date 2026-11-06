import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useReferralLinks, useSources } from '@/lib/data';
import { allEventsUrl } from '@/lib/links';
import { Badge, Button, EmptyState, ErrorBox, Input, Notice, Panel, Select, Skeleton } from '@/ui/kit';
import { Dialog, useCopy, useToast } from '@/ui/feedback';

/** Channel/campaign links (?ref=code): the third, separate source dimension. */
export function LinksSettings() {
  const links = useReferralLinks();
  const sources = useSources();
  const qc = useQueryClient();
  const toast = useToast();
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('referral_links').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['links'] }); toast.success('הקישור עודכן'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const label = (id: string | null) => sources.data?.find((s) => s.id === id)?.label;
  return (
    <div className="flex flex-col gap-4">
      <Notice icon="link">
        לכל ערוץ פרסום קישור משלו (ביו באינסטגרם, קבוצת וואטסאפ מסוימת, שותף). מי שנרשם דרכו נספר לערוץ הזה בדוח "מקורות והפניות", בנפרד ממה שהוא עונה ב"איך שמעת עלינו".
        הקישור כאן מוביל לרשימת המפגשים הפתוחים. קישור למפגש מסוים נמצא בעמוד המפגש.
      </Notice>
      <Panel title="קישורים לפי ערוץ" padded={false} actions={<Button icon="plus" onClick={() => setOpen(true)}>קישור חדש</Button>}>
        {links.isLoading ? <div className="p-5"><Skeleton lines={4} /></div> : links.error ? <div className="p-5"><ErrorBox error={errorMessage(links.error)} /></div> : !links.data?.length ? (
          <EmptyState icon="link" title="עוד אין קישורים לפי ערוץ" action={<Button icon="plus" onClick={() => setOpen(true)}>קישור ראשון</Button>}>למשל: "ביו באינסטגרם" או "קבוצת המילואים של מודיעין".</EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft">
            {links.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-48 flex-1">
                  <div className="font-semibold">{l.label} {!l.is_active && <Badge>מושבת</Badge>}</div>
                  <div className="text-sm text-muted">{label(l.source_id) ?? 'בלי ערוץ'}{l.campaign ? ` · ${l.campaign}` : ''} · <span className="num">ref={l.code}</span></div>
                </div>
                <Button size="sm" variant="secondary" icon="copy" disabled={!l.is_active} onClick={() => copy(allEventsUrl(l.code), 'הקישור הועתק')}>העתקה</Button>
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: l.id, is_active: !l.is_active })}>{l.is_active ? 'השבתה' : 'הפעלה'}</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <NewLink open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function NewLink({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (code: string) => void }) {
  const sources = useSources();
  const qc = useQueryClient();
  const toast = useToast();
  const [labelText, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [source, setSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from('referral_links').insert({ label: labelText.trim(), code, source_id: source || null, campaign: campaign.trim() || null });
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['links'] });
      toast.success('הקישור נוצר');
      onCreated?.(code);
      setLabel(''); setCode(''); setSource(''); setCampaign('');
      onClose();
    },
    onError: (e: { code?: string }) => setError(e.code === '23505' ? 'הקוד הזה כבר בשימוש. בחרו קוד אחר.' : errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (labelText.trim().length < 2) return setError('צריך שם לקישור.');
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(code) || code.startsWith('f-')) return setError('הקוד: אותיות באנגלית קטנות, ספרות ומקף, 2–40 תווים.');
    save.mutate();
  };
  return (
    <Dialog open={open} onClose={onClose} title="קישור הרשמה לערוץ" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input label="שם (לשימוש פנימי)" value={labelText} onChange={(e) => setLabel(e.target.value)} placeholder="ביו באינסטגרם" />
        <Input label="קוד בקישור" ltr value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="ig-bio" hint="מופיע בקישור: ?ref=ig-bio" />
        <Select label="ערוץ" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">בלי</option>
          {(sources.data ?? []).filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        <Input label="קמפיין (לא חובה)" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="נובמבר 2026" />
        {error && <ErrorBox error={error} />}
        <div className="flex gap-2"><Button type="submit" busy={save.isPending}>יצירת הקישור</Button><Button variant="ghost" onClick={onClose}>ביטול</Button></div>
      </form>
    </Dialog>
  );
}
