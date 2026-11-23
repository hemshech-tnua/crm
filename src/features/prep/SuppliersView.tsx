import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { DISMISS } from '@/lib/labels';
import { PHONE_EXAMPLE, formatPhone, normalizePhone, telLink, whatsappLink } from '@/lib/phone';
import type { Supplier } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, ExternalButton, IconButton, Input, Panel, Skeleton, Table, Td, Th, Textarea, cx } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { useSuppliers } from './shared';

function PhoneLinks({ s }: { s: Supplier }) {
  if (!s.phone) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <a href={telLink(s.phone)} className="num inline-flex min-h-11 items-center px-1 font-semibold whitespace-nowrap text-tide hover:underline"><span className="sr-only">חיוג אל {s.name}: </span>{formatPhone(s.phone)}</a>
      <ExternalButton href={whatsappLink(s.phone)} size="sm" variant="ghost" icon="message" label={`וואטסאפ אל ${s.name}`} className="px-2.5" />
    </span>
  );
}

/** The suppliers book: who supplies what, how to reach them, and roughly what it costs. */
export function SuppliersView() {
  const q = useSuppliers();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const all = q.data ?? [];
  const active = all.filter((s) => s.is_active);
  const inactive = all.filter((s) => !s.is_active);
  const rows = showInactive ? [...active, ...inactive] : active;

  return (
    <Panel
      title="ספר הספקים"
      description="אוכל, מקום, ציוד ושותפים קבועים. מכאן בוחרים ספק כשרושמים תשלום למפגש."
      actions={<Button icon="plus" size="sm" onClick={() => setEditing('new')}>ספק חדש</Button>}
      padded={false}
    >
      {q.isError ? <div className="p-4"><ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>
        : q.isLoading ? <div className="p-4"><Skeleton shape="rows" count={5} height={64} /></div>
        : !all.length ? (
          <EmptyState icon="people" title="עוד אין ספקים בספר" action={<Button icon="plus" onClick={() => setEditing('new')}>הוספת הספק הראשון</Button>}>
            קייטרינג, מקום, ציוד, מאמן או מרצה בתשלום: מוסיפים פעם אחת, ומשם בוחרים בכל מפגש.
          </EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table label="ספקים" className="rounded-none border-0">
                <thead>
                  <tr><Th>שם</Th><Th>מה</Th><Th>ליצירת קשר</Th><Th>טלפון</Th><Th>עלות</Th><Th><span className="sr-only">פעולות</span></Th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className={cx(!s.is_active && 'text-muted')}>
                      <Td className="font-semibold">
                        {s.name}
                        {!s.is_active && <span className="ms-2"><Badge>לא פעיל</Badge></span>}
                        {s.notes && <span className="block text-small font-normal text-muted">{s.notes}</span>}
                      </Td>
                      <Td className="text-ink-soft">{s.what || '—'}</Td>
                      <Td>{s.contact_name || '—'}</Td>
                      <Td><PhoneLinks s={s} /></Td>
                      <Td className="text-ink-soft">{s.cost_note || '—'}</Td>
                      <Td className="w-12"><IconButton icon="edit" label={`עריכה: ${s.name}`} onClick={() => setEditing(s)} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-edge md:hidden" aria-label="ספקים">
              {rows.map((s) => (
                <li key={s.id} className={cx('px-4 py-3', !s.is_active && 'text-muted')}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.name}{!s.is_active && <span className="ms-2"><Badge>לא פעיל</Badge></span>}</p>
                      {s.what && <p className="text-small text-ink-soft">{s.what}</p>}
                      {(s.contact_name || s.cost_note) && <p className="text-small text-muted">{[s.contact_name, s.cost_note].filter(Boolean).join(' · ')}</p>}
                    </div>
                    <IconButton icon="edit" label={`עריכה: ${s.name}`} onClick={() => setEditing(s)} className="-my-1.5 -me-2" />
                  </div>
                  {s.phone && <div className="-ms-1 mt-0.5"><PhoneLinks s={s} /></div>}
                </li>
              ))}
            </ul>
            {inactive.length > 0 && (
              <div className="border-t border-edge px-4 sm:px-5">
                <button type="button" onClick={() => setShowInactive((v) => !v)} aria-expanded={showInactive} className="flex min-h-11 items-center gap-1.5 text-small font-semibold text-tide hover:underline">
                  <Icon name="chevron" size={16} className={cx('transition-transform', showInactive && '-rotate-90')} />
                  {showInactive ? 'הסתרת' : 'הצגת'} לא פעילים (<span className="num">{inactive.length}</span>)
                </button>
              </div>
            )}
          </>
        )}
      {editing && <SupplierDialog supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [initial] = useState(() => ({
    name: supplier?.name ?? '',
    what: supplier?.what ?? '',
    contact_name: supplier?.contact_name ?? '',
    phone: formatPhone(supplier?.phone),
    cost_note: supplier?.cost_note ?? '',
    notes: supplier?.notes ?? ''
  }));
  const [f, setF] = useState(initial);
  // a form dialog with typed changes ignores a tap outside, and asks before Escape or × close it
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: async (patch: Partial<Supplier> | null) => {
      const row = patch ?? {
        name: f.name.trim(),
        what: f.what.trim() || null,
        contact_name: f.contact_name.trim() || null,
        phone: f.phone.trim() ? normalizePhone(f.phone) : null,
        cost_note: f.cost_note.trim() || null,
        notes: f.notes.trim() || null,
      };
      const res = supplier ? await supabase.from('suppliers').update(row).eq('id', supplier.id) : await supabase.from('suppliers').insert(row);
      if (res.error) throw res.error;
      return patch;
    },
    onSuccess: (patch) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(patch ? (patch.is_active ? 'הספק חזר לפעילות' : 'הספק הועבר ללא פעילים') : supplier ? 'הפרטים נשמרו' : 'הספק נוסף');
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const next = {
      name: f.name.trim().length < 2 ? 'צריך לכתוב שם.' : f.name.trim().length > 80 ? 'עד 80 תווים.' : null,
      phone: f.phone.trim() && !normalizePhone(f.phone) ? `מספר הטלפון לא נראה תקין. למשל ${PHONE_EXAMPLE}.` : null,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    save.mutate(null);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!dirty}
      title={supplier ? `עריכה: ${supplier.name}` : 'ספק חדש'}
      footer={<>
        <Button busy={save.isPending && !save.variables} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>
        {supplier && (
          <Button variant="secondary" className="ms-auto" busy={save.isPending && !!save.variables} onClick={() => save.mutate({ is_active: !supplier.is_active })}>
            {supplier.is_active ? 'העברה ללא פעילים' : 'החזרה לפעילות'}
          </Button>
        )}
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="שם" required value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} maxLength={80} autoFocus={!supplier} />
        <Input label="מה מספקים" value={f.what} onChange={(e) => set('what', e.target.value)} maxLength={120} placeholder="למשל: ארוחת בוקר, הגברה, עצים למדורה" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="שם ליצירת קשר" value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} maxLength={80} />
          <Input label="טלפון" ltr type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        </div>
        <Input label="עלות" value={f.cost_note} onChange={(e) => set('cost_note', e.target.value)} maxLength={120} placeholder="למשל: 45 ₪ למנה, מינימום 20" />
        <Textarea label="הערות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} rows={3} />
        {formError && <p className="text-small font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
