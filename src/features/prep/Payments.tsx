import { useId, useState } from 'react';
import { parseAmount } from '@/lib/money';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { todayIl } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { DISMISS } from '@/lib/labels';
import type { EventPayment } from '@/lib/types';
import { Badge, Button, Checkbox, EmptyState, ErrorBox, IconButton, Input, Panel, Skeleton, Td, Th, Textarea, cx } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { TickBox, dm, fmtMoney, useSuppliers } from './shared';

const PAY_COLS = 'id,event_id,supplier_id,supplier,description,amount,due_date,invoice_received,paid_on,notes';

export const useEventPayments = (eventId: string) =>
  useQuery({
    queryKey: ['event_payments', 'event', eventId],
    queryFn: async () => must(await supabase.from('event_payments').select(PAY_COLS).eq('event_id', eventId).order('created_at')) as EventPayment[],
  });

export type UnpaidPayment = EventPayment & { event: { id: string; title: string; starts_at: string } };
/** Payments not paid yet for meetings that already took place. */
export const useUnpaidPast = () =>
  useQuery({
    queryKey: ['event_payments', 'unpaid-past'],
    queryFn: async () => must(await supabase.from('event_payments').select(`${PAY_COLS},event:events!inner(id,title,starts_at)`)
      .is('paid_on', null).lt('event.starts_at', new Date().toISOString()).neq('event.status', 'cancelled')
      .order('created_at').limit(100)) as unknown as UnpaidPayment[],
  });

function usePatchPayment() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<EventPayment> }) => {
      const { error } = await supabase.from('event_payments').update(patch).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['event_payments'] });
      const snapshot = qc.getQueriesData<EventPayment[]>({ queryKey: ['event_payments'] });
      qc.setQueriesData<EventPayment[]>({ queryKey: ['event_payments'] }, (old) => (Array.isArray(old) ? old.map((p) => (p.id === id ? { ...p, ...patch } : p)) : old));
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['event_payments'] }),
  });
}

/** Someone this meeting surely pays (its speaker, its coach), offered as a one-tap "למי משלמים". */
export type PayeeHint = { name: string; what: string };

export function PaymentsPanel({ eventId, people = [] }: { eventId: string; people?: PayeeHint[] }) {
  const q = useEventPayments(eventId);
  const patch = usePatchPayment();
  const [editing, setEditing] = useState<EventPayment | 'new' | null>(null);
  const rows = q.data ?? [];
  const total = rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const paid = rows.filter((p) => p.paid_on).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const today = todayIl();
  const payToday = (p: EventPayment) => patch.mutate({ id: p.id, patch: { paid_on: today } });
  const setInvoice = (p: EventPayment, v: boolean) => patch.mutate({ id: p.id, patch: { invoice_received: v } });

  return (
    <Panel
      id="payments"
      title="תשלומים לספקים"
      description={rows.length ? (
        <span className="flex flex-wrap gap-x-3">
          <span>סה״כ <b className="num text-ink">{fmtMoney(total)}</b></span>
          <span>שולם <b className="num text-ink">{fmtMoney(paid)}</b></span>
          {total - paid > 0 && <span className="font-semibold text-warn">נותר לשלם <span className="num">{fmtMoney(total - paid)}</span></span>}
        </span>
      ) : 'למי משלמים על המפגש הזה, ומה כבר שולם'}
      actions={<Button size="sm" variant="secondary" icon="plus" onClick={() => setEditing('new')}>הוספת תשלום</Button>}
      padded={false}
    >
      {q.isError && !q.data ? <div className="p-4"><ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>
        : q.isLoading ? <div className="p-4"><Skeleton lines={3} /></div>
        : !rows.length ? (
          <EmptyState icon="task" title="עוד אין תשלומים" action={<Button icon="plus" onClick={() => setEditing('new')}>הוספת תשלום</Button>}>
            מרצה, אוכל, ציוד או מקום: רושמים כאן, מסמנים כשהגיעה חשבונית, ובסוף "שולם".
          </EmptyState>
        ) : (
          <>
            <table className="hidden w-full border-collapse text-body md:table" aria-label="תשלומים למפגש">
              <thead>
                <tr><Th>ספק</Th><Th>עבור</Th><Th numeric>סכום</Th><Th>חשבונית</Th><Th>שולם</Th><Th><span className="sr-only">פעולות</span></Th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={cx(!p.paid_on && 'bg-warn-wash/45')}>
                    <Td className={cx('font-semibold', !p.paid_on && 'border-s-[3px] border-s-warn')}>{p.supplier}</Td>
                    <Td className="text-ink-soft">{p.description || '—'}</Td>
                    <Td numeric className="font-semibold">{fmtMoney(p.amount)}</Td>
                    <Td><TickBox checked={p.invoice_received} onChange={(v) => setInvoice(p, v)} label={`חשבונית התקבלה: ${p.supplier}`} /></Td>
                    <Td>
                      {p.paid_on ? <Badge tone="good" icon="check">שולם <span className="num">{dm(p.paid_on)}</span></Badge>
                        : <Button size="sm" variant="secondary" onClick={() => payToday(p)} aria-label={`שולם היום: ${p.supplier}`}>שולם היום</Button>}
                    </Td>
                    <Td className="w-12"><IconButton icon="edit" label={`עריכה: ${p.supplier}`} onClick={() => setEditing(p)} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-edge md:hidden" aria-label="תשלומים למפגש">
              {rows.map((p) => (
                <li key={p.id} className={cx('px-4 py-3', !p.paid_on && 'border-s-[3px] border-s-warn bg-warn-wash/45')}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{p.supplier}</p>
                      {p.description && <p className="text-small text-ink-soft">{p.description}</p>}
                    </div>
                    <span className="num pt-0.5 font-bold">{fmtMoney(p.amount)}</span>
                    <IconButton icon="edit" label={`עריכה: ${p.supplier}`} onClick={() => setEditing(p)} className="-my-2 -me-2" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-small">
                      <TickBox checked={p.invoice_received} onChange={(v) => setInvoice(p, v)} label={`חשבונית התקבלה: ${p.supplier}`} />
                      <span aria-hidden="true">חשבונית</span>
                    </label>
                    {p.paid_on ? <Badge tone="good" icon="check">שולם <span className="num">{dm(p.paid_on)}</span></Badge>
                      : <Button size="sm" variant="secondary" onClick={() => payToday(p)} aria-label={`שולם היום: ${p.supplier}`}>שולם היום</Button>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      {editing && (
        <PaymentDialog
          payment={editing === 'new' ? null : editing}
          eventId={eventId}
          hints={people.filter((h) => !rows.some((p) => p.supplier.trim() === h.name.trim()))}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function PaymentDialog({ payment, eventId, hints = [], onClose }: { payment: EventPayment | null; eventId: string; hints?: PayeeHint[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const suppliers = useSuppliers();
  const listId = useId();
  const [initial] = useState(() => ({
    supplier: payment?.supplier ?? '',
    description: payment?.description ?? '',
    amount: payment?.amount != null ? String(Number(payment.amount)) : '',
    invoice_received: payment?.invoice_received ?? false,
    paid_on: payment?.paid_on ?? '',
    notes: payment?.notes ?? '',
    addToBook: false
  }));
  const [f, setF] = useState(initial);
  // a form dialog with typed changes ignores a tap outside, and asks before Escape or × close it
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const active = (suppliers.data ?? []).filter((s) => s.is_active);
  const known = (suppliers.data ?? []).find((s) => s.name.trim() === f.supplier.trim());
  const isNew = f.supplier.trim().length >= 2 && !known;

  const save = useMutation({
    mutationFn: async () => {
      let supplierId = known?.id ?? null;
      if (!supplierId && f.addToBook) {
        const { data, error } = await supabase.from('suppliers').insert({ name: f.supplier.trim(), what: f.description.trim() || null }).select('id').single();
        if (error) throw error;
        supplierId = data.id as string;
      }
      const row = {
        supplier: f.supplier.trim(),
        supplier_id: supplierId,
        description: f.description.trim() || null,
        amount: parseAmount(f.amount),
        invoice_received: f.invoice_received,
        paid_on: f.paid_on || null,
        notes: f.notes.trim() || null,
      };
      const res = payment
        ? await supabase.from('event_payments').update(row).eq('id', payment.id)
        : await supabase.from('event_payments').insert({ ...row, event_id: eventId });
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event_payments'] });
      if (f.addToBook) qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(payment ? 'התשלום נשמר' : 'התשלום נוסף');
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('event_payments').delete().eq('id', payment!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event_payments'] });
      toast.success('התשלום נמחק');
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const amount = parseAmount(f.amount);
    const next = {
      supplier: f.supplier.trim().length < 2 ? 'צריך לכתוב למי משלמים.' : f.supplier.trim().length > 80 ? 'עד 80 תווים.' : null,
      amount: amount != null && (Number.isNaN(amount) || amount < 0 || amount > 1_000_000) ? 'צריך סכום חיובי, למשל 450.' : null,
      description: f.description.length > 160 ? 'עד 160 תווים.' : null,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    save.mutate();
  };
  const del = async () => {
    if (await confirm({ title: 'מחיקת התשלום', body: <>למחוק את התשלום ל{payment!.supplier}?</>, confirm: 'מחיקה', danger: true })) remove.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!dirty}
      title={payment ? 'עריכת תשלום' : 'תשלום חדש'}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>{payment ? 'שמירה' : 'הוספה'}</Button>
        <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>
        {payment && <Button variant="danger" className="ms-auto" busy={remove.isPending} onClick={del}>מחיקה</Button>}
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input
          label="למי משלמים"
          required
          list={listId}
          autoComplete="off"
          value={f.supplier}
          onChange={(e) => set('supplier', e.target.value)}
          error={errors.supplier}
          maxLength={80}
          hint={known ? [known.what, known.cost_note].filter(Boolean).join(' · ') || 'מספר הספקים' : 'בוחרים מספר הספקים, או כותבים שם חדש'}
          autoFocus={!payment && !hints.length}
        />
        {!payment && hints.length > 0 && !f.supplier.trim() && (
          <div className="-mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="הצעות מהמפגש">
            <span className="text-small text-muted">מהמפגש:</span>
            {hints.map((h) => (
              <button
                key={h.name}
                type="button"
                onClick={() => setF((x) => ({ ...x, supplier: h.name, description: x.description || h.what }))}
                className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-control-line px-3 text-small font-medium text-ink hover:border-ink pointer-coarse:h-11"
              >
                {h.name}<span className="text-muted">· {h.what}</span>
              </button>
            ))}
          </div>
        )}
        <datalist id={listId}>{active.map((s) => <option key={s.id} value={s.name}>{s.what ?? ''}</option>)}</datalist>
        {isNew && <Checkbox label="להוסיף לספר הספקים" hint="כדי לבחור אותו בפעם הבאה בלי להקליד" checked={f.addToBook} onChange={(v) => set('addToBook', v)} />}
        <Input label="עבור מה" value={f.description} onChange={(e) => set('description', e.target.value)} error={errors.description} maxLength={160} placeholder="למשל: ארוחת בוקר ל־30" />
        <Input label="סכום (₪)" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} error={errors.amount} ltr className="num" />
        <Checkbox label="חשבונית התקבלה" checked={f.invoice_received} onChange={(v) => set('invoice_received', v)} />
        <div className="flex flex-wrap items-end gap-2">
          <Input label="שולם בתאריך" type="date" value={f.paid_on} onChange={(e) => set('paid_on', e.target.value)} className="w-48" />
          {!f.paid_on && <Button variant="secondary" onClick={() => set('paid_on', todayIl())}>שולם היום</Button>}
        </div>
        <Textarea label="הערות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} rows={2} />
        {formError && <p className="text-small font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
