import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useSites, useSources } from '@/lib/data';
import { downloadFile } from '@/lib/csv';
import { siteCheckinUrl } from '@/lib/links';
import type { Site, Source } from '@/lib/types';
import { Badge, Button, Checkbox, ErrorBox, Input, Notice, Panel, Skeleton } from '@/ui/kit';
import { Dialog, useConfirm, useCopy, useToast } from '@/ui/feedback';
import { QrImage } from '@/features/events/shared';
import { dataUrlToBlob } from '@/features/events/context';

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
  const [sign, setSign] = useState<Site | null>(null);
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
              <Button size="sm" variant="secondary" icon="qr" onClick={() => setSign(s)}>שלט קבוע לכניסה</Button>
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setF(s)}>עריכה</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-4 text-sm text-muted">לכל מתחם מפגשים משלו, וברקוד קבוע אחד לשלט בכניסה. בדוחות ובדשבורד אפשר לסנן לפי מתחם (שאלה 43 בשאלון).</p>
      {sign && <SiteSignDialog site={(sites.data ?? []).find((x) => x.id === sign.id) ?? sign} onClose={() => setSign(null)} />}
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

/**
 * The permanent entrance sign of a site: one QR for every meeting there (#/s/<code>). Downloads as SVG (vector, for
 * laser engraving or print shops) and PNG, with high error correction so a worn or engraved code still scans.
 */
function SiteSignDialog({ site, onClose }: { site: Site; onClose: () => void }) {
  const role = useRole();
  const toast = useToast();
  const copy = useCopy();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const url = siteCheckinUrl(site.checkin_code);
  const opts = { errorCorrectionLevel: 'H' as const, margin: 4, color: { dark: '#000000', light: '#FFFFFF' } };
  const file = `שלט-כניסה-${site.name}`.replace(/[\\/:*?"<>|]+/g, '-');
  const svg = async () => {
    try {
      downloadFile(`${file}.svg`, new Blob([await QRCode.toString(url, { ...opts, type: 'svg' })], { type: 'image/svg+xml' }));
    } catch {
      toast.error('לא הצלחנו ליצור את הקובץ. נסו שוב.');
    }
  };
  const png = async () => {
    try {
      downloadFile(`${file}.png`, dataUrlToBlob(await QRCode.toDataURL(url, { ...opts, width: 2048 })));
    } catch {
      toast.error('לא הצלחנו ליצור את הקובץ. נסו שוב.');
    }
  };
  const rotate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_rotate_site_code', { p_site_id: site.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); toast.success('נוצר קוד חדש. השלט הישן כבר לא עובד.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const askRotate = async () => {
    const ok = await confirm({
      title: 'להחליף את הקוד של השלט?',
      danger: true,
      confirm: 'החלפת הקוד',
      cancel: 'חזרה',
      body: <p>רק אם הקוד דלף ומשתמשים בו מרחוק. השלט הקיים יפסיק לעבוד מיד, וצריך להכין שלט חדש.</p>,
    });
    if (ok) rotate.mutate();
  };
  return (
    <Dialog open onClose={onClose} title={`שלט קבוע לכניסה: ${site.name}`}>
      <div className="flex flex-col gap-4">
        <p className="text-[0.95rem] text-ink-soft">
          ברקוד אחד לכל המפגשים במתחם. מי שסורק/ת מגיע/ה לצ׳ק־אין של המפגש שפתוח באותו רגע. אם אין מפגש פתוח, מופיע מתי ייפתח הבא.
        </p>
        <div className="flex justify-center"><QrImage value={url} size={220} label={`ברקוד קבוע לכניסה, ${site.name}`} className="rounded-lg border border-line-soft" /></div>
        <div className="flex items-center gap-2">
          <code dir="ltr" className="num min-w-0 flex-1 truncate rounded-[var(--radius-control)] bg-mist px-3 py-2 text-sm">{url}</code>
          <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(url, 'הקישור הועתק')}>העתקה</Button>
        </div>
        <Notice tone="warn" icon="alert">
          לפני חריטה או הדפסה קבועה: הברקוד מכיל את כתובת האתר. אם הכתובת תשתנה (למשל במעבר לדומיין של העמותה), השלט יפסיק לעבוד. כדאי לחרוט רק אחרי שהכתובת סופית.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button icon="download" onClick={svg}>הורדה לחריטה (SVG)</Button>
          <Button variant="secondary" icon="download" onClick={png}>הורדה כתמונה (PNG)</Button>
        </div>
        <p className="text-sm text-muted">הקובץ בשחור־לבן, עם תיקון שגיאות גבוה ושוליים לבנים, כך שגם שלט עם שריטות או בחריטה על עץ נסרק. מומלץ גודל של 10 ס״מ לפחות.</p>
        {can.admin(role) && (
          <button type="button" onClick={askRotate} disabled={rotate.isPending} className="self-start text-sm font-semibold text-bad underline underline-offset-4">
            הקוד דלף? החלפת הקוד (השלט הישן יפסיק לעבוד)
          </button>
        )}
      </div>
    </Dialog>
  );
}
