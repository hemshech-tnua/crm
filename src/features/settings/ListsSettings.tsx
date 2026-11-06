import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useSites, useSources } from '@/lib/data';
import type { Site, Source } from '@/lib/types';
import { Badge, Button, Checkbox, ErrorBox, Input, Panel, Skeleton } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';

// ───────────── acquisition sources ─────────────

export function SourcesSettings() {
  const sources = useSources();
  const [editing, setEditing] = useState<Partial<Source> | null>(null);
  return (
    <Panel title="אפשרויות ב'איך שמעת עלינו?'" padded={false} actions={<Button icon="plus" onClick={() => setEditing({ is_active: true, is_friend: false, asks_detail: false, sort_order: 80 })}>מקור חדש</Button>}>
      {sources.isLoading ? <div className="p-5"><Skeleton lines={5} /></div> : sources.error ? <div className="p-5"><ErrorBox error={errorMessage(sources.error)} /></div> : (
        <ul className="divide-y divide-line-soft">
          {(sources.data ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <span className={`flex-1 font-medium ${s.is_active ? '' : 'text-faint line-through'}`}>{s.label}</span>
              {s.is_friend && <Badge tone="light">נספר כ"דרך חבר"</Badge>}
              {s.asks_detail && <Badge>מבקש פירוט</Badge>}
              {!s.is_active && <Badge>מוסתר מהטופס</Badge>}
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(s)}>עריכה</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-4 text-sm text-muted">מקור שכבר נבחר בעבר לא נמחק, רק מוסתר מהטופס, כדי שהדוחות על העבר יישארו נכונים.</p>
      <SourceDialog value={editing} onClose={() => setEditing(null)} />
    </Panel>
  );
}

function SourceDialog({ value, onClose }: { value: Partial<Source> | null; onClose: () => void }) {
  return (
    <Dialog open={!!value} onClose={onClose} title={value?.id ? 'עריכת מקור' : 'מקור חדש'} size="sm">
      {value && <SourceForm key={value.id ?? 'new'} initial={value} onDone={onClose} />}
    </Dialog>
  );
}

function SourceForm({ initial, onDone }: { initial: Partial<Source>; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Partial<Source>>({ ...initial });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const row = { label: f.label?.trim(), is_friend: !!f.is_friend, asks_detail: !!f.asks_detail, is_active: !!f.is_active, sort_order: Number(f.sort_order ?? 100) };
      const res = f.id
        ? await supabase.from('acquisition_sources').update(row).eq('id', f.id)
        : await supabase.from('acquisition_sources').insert({ ...row, key: `src_${Date.now().toString(36)}` });
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sources'] }); toast.success('המקור נשמר'); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.label || f.label.trim().length < 2) return setError('צריך שם למקור.'); save.mutate(); };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input label="הטקסט בטופס" value={f.label ?? ''} onChange={(e) => setF({ ...f, label: e.target.value })} />
      <Input label="סדר הופעה" type="number" value={String(f.sort_order ?? 100)} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} hint="מספר קטן מופיע קודם" />
      <Checkbox checked={!!f.is_friend} onChange={(v) => setF({ ...f, is_friend: v })} label="זה מקור של חבר" hint='שואל "מי הביא/ה אותך?" ונספר ביעד "הגיעו דרך חבר"' />
      <Checkbox checked={!!f.asks_detail} onChange={(v) => setF({ ...f, asks_detail: v })} label="לבקש פירוט בטקסט חופשי" />
      <Checkbox checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="מופיע בטופס ההרשמה" />
      {error && <ErrorBox error={error} />}
      <div className="flex gap-2"><Button type="submit" busy={save.isPending}>שמירה</Button><Button variant="ghost" onClick={onDone}>ביטול</Button></div>
    </form>
  );
}

// ───────────── sites (מתחמים) ─────────────

export function SitesSettings() {
  const sites = useSites();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Partial<Site> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: f!.name?.trim(), address: f!.address?.trim() || null, is_active: f!.is_active ?? true };
      const res = f!.id ? await supabase.from('sites').update(row).eq('id', f!.id) : await supabase.from('sites').insert(row);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); toast.success('המתחם נשמר'); setF(null); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Panel title="מתחמים" padded={false} actions={<Button icon="plus" onClick={() => setF({ is_active: true })}>מתחם חדש</Button>}>
      {sites.isLoading ? <div className="p-5"><Skeleton lines={3} /></div> : (
        <ul className="divide-y divide-line-soft">
          {(sites.data ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="flex-1"><div className="font-semibold">{s.name}</div><div className="text-sm text-muted">{s.address}</div></div>
              {!s.is_active && <Badge>לא פעיל</Badge>}
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setF(s)}>עריכה</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-4 text-sm text-muted">לכל מתחם מפגשים משלו. בדוחות ובדשבורד אפשר לסנן לפי מתחם (שאלה 43 בשאלון).</p>
      <Dialog open={!!f} onClose={() => { setF(null); setError(null); }} title={f?.id ? 'עריכת מתחם' : 'מתחם חדש'} size="sm">
        {f && (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!f.name || f.name.trim().length < 2) return setError('צריך שם למתחם.'); save.mutate(); }}>
            <Input label="שם" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input label="כתובת" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} />
            <Checkbox checked={f.is_active ?? true} onChange={(v) => setF({ ...f, is_active: v })} label="פעיל" />
            {error && <ErrorBox error={error} />}
            <div className="flex gap-2"><Button type="submit" busy={save.isPending}>שמירה</Button><Button variant="ghost" onClick={() => setF(null)}>ביטול</Button></div>
          </form>
        )}
      </Dialog>
    </Panel>
  );
}
