// Participant payments on the staff screens: the payment badge, the "mark payment" dialog and the meeting's finance
// snapshot (migration 20261106002300_payments.sql). Payment itself happens on the provider's page, never here.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { fmtMoney, isPriced, parseAmount } from '@/lib/money';
import { PAYMENT_METHOD_LABEL } from '@/lib/labels';
import type { EventRow, PaymentMethod, PaymentStatus, RegStatus } from '@/lib/types';
import { Badge, Button, ChoiceGroup, Input, Panel, Select } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';
import { useInvalidateEvent } from './queries';
import { BigStat } from './shared';

export type EventFinance = {
  event_id: string;
  price: number | null;
  has_payment_link: boolean;
  registered: number;
  income: {
    expected: number; collected: number; paid_count: number; pending_count: number; pending_amount: number;
    waived_count: number; refunded_count: number; refunded_amount: number;
  };
  expenses: { count: number; total: number; paid: number; unpaid: number };
  net: number;
  projected_net: number;
};

// under ['event_payments', …] on purpose: adding or paying a supplier (prep/Payments) refreshes the snapshot too
export const financeKey = (eventId: string) => ['event_payments', 'finance', eventId] as const;

export const useEventFinance = (eventId: string, enabled = true) =>
  useQuery({
    queryKey: financeKey(eventId),
    enabled,
    queryFn: async () => must(await supabase.rpc('staff_event_finance', { p_event_id: eventId })) as EventFinance,
  });

/** Whether a row's payment is worth a badge: pending only for a registered place; paid, waived and refunded always. */
export const showsPayment = (status: RegStatus, payment: PaymentStatus) =>
  payment === 'paid' || payment === 'waived' || payment === 'refunded' || (payment === 'pending' && status === 'registered');

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  if (status === 'paid') return <Badge tone="good" icon="check">שולם</Badge>;
  if (status === 'pending') return <Badge tone="warn" icon="alert">לא שולם</Badge>;
  if (status === 'waived') return <Badge tone="neutral">פטור מתשלום</Badge>;
  if (status === 'refunded') return <Badge tone="neutral">התשלום הוחזר</Badge>;
  return null;
}

// ───────────── marking a payment ─────────────

export type PaymentTarget = {
  id: string;
  name: string | null;
  payment_status: PaymentStatus;
  paid_amount: number | null;
  payment_method: PaymentMethod | null;
  payment_ref: string | null;
};

const METHODS: PaymentMethod[] = ['cash', 'bit', 'paybox', 'card', 'transfer', 'other'];

export function PaymentDialog({ target, event, onClose }: { target: PaymentTarget | null; event: Pick<EventRow, 'id' | 'price'>; onClose: () => void }) {
  return (
    <Dialog open={!!target} onClose={onClose} title={target?.name ? `תשלום: ${target.name}` : 'סימון תשלום'} size="sm">
      {target && <PaymentForm key={target.id} target={target} event={event} onClose={onClose} />}
    </Dialog>
  );
}

function PaymentForm({ target: t, event, onClose }: { target: PaymentTarget; event: Pick<EventRow, 'id' | 'price'>; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const wasPaid = t.payment_status === 'paid' || t.payment_status === 'refunded';
  const [status, setStatus] = useState<PaymentStatus>(t.payment_status === 'pending' || t.payment_status === 'none' ? 'paid' : t.payment_status);
  const [amount, setAmount] = useState(String(t.paid_amount ?? (isPriced(event.price) ? Number(event.price) : '')));
  const [method, setMethod] = useState<PaymentMethod>(t.payment_method ?? 'cash');
  const [ref, setRef] = useState(t.payment_ref ?? '');
  const [errors, setErrors] = useState<{ amount?: string; form?: string }>({});

  const options: { value: PaymentStatus; label: string }[] = [
    { value: 'paid', label: 'שולם' },
    { value: 'pending', label: 'לא שולם' },
    { value: 'waived', label: 'פטור מתשלום' },
    ...(wasPaid ? [{ value: 'refunded' as const, label: 'התשלום הוחזר' }] : []),
  ];

  const save = useMutation({
    mutationFn: async () => {
      const value = parseAmount(amount);
      const { error } = await supabase.rpc('staff_set_payment', {
        p_registration_id: t.id,
        p_status: status,
        p_amount: status === 'paid' || status === 'refunded' ? value : null,
        p_method: status === 'paid' ? method : null,
        p_ref: status === 'pending' ? null : ref.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate(event.id);
      toast.success(status === 'paid' ? `${t.name ?? ''}: סומן ששולם` : status === 'pending' ? `${t.name ?? ''}: סומן שלא שולם` : 'התשלום עודכן');
      onClose();
    },
    onError: (err) => (errorCode(err) === 'invalid_amount' ? setErrors({ amount: errorMessage(err) }) : setErrors({ form: errorMessage(err) })),
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (status === 'paid' || status === 'refunded') {
      const v = parseAmount(amount);
      if (v == null || Number.isNaN(v) || v <= 0 || v > 100000) {
        setErrors({ amount: 'צריך סכום חיובי, למשל 20.' });
        return;
      }
    }
    setErrors({});
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <ChoiceGroup<PaymentStatus> legend="מצב התשלום" columns={2} value={status} onChange={setStatus} options={options} />
      {(status === 'paid' || status === 'refunded') && (
        <Input
          label={status === 'refunded' ? 'הסכום שהוחזר (₪)' : 'סכום (₪)'}
          inputMode="decimal"
          ltr
          className="num"
          value={amount}
          onChange={(x) => { setAmount(x.target.value); setErrors({}); }}
          error={errors.amount}
          hint={isPriced(event.price) ? `דמי ההשתתפות: ${fmtMoney(event.price)}` : undefined}
        />
      )}
      {status === 'paid' && (
        <Select label="אמצעי תשלום" value={method} onChange={(x) => setMethod(x.target.value as PaymentMethod)}>
          {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
        </Select>
      )}
      {status !== 'pending' && (
        <Input
          label={status === 'waived' ? 'סיבה (לא חובה)' : 'אסמכתה (לא חובה)'}
          value={ref}
          onChange={(x) => setRef(x.target.value)}
          maxLength={100}
          hint={status === 'paid' ? 'מספר עסקה מחברת התשלום, או הערה קצרה' : undefined}
        />
      )}
      {errors.form && <p className="text-small font-medium text-bad" role="alert">{errors.form}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" icon="check" busy={save.isPending}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </div>
    </form>
  );
}

// ───────────── the meeting's money ─────────────

/**
 * Income (expected, collected, still owed) and expenses (the meeting's supplier payments). Shown for a meeting with a
 * fee, and for a free one that has expenses or took money.
 */
export function FinancePanel({ e, onUnpaid, onExpenses }: { e: Pick<EventRow, 'id' | 'price'>; onUnpaid?: () => void; onExpenses?: () => void }) {
  const q = useEventFinance(e.id);
  const f = q.data;
  if (!f || (!isPriced(f.price) && f.expenses.count === 0 && f.income.collected <= 0)) return null;
  const i = f.income;
  const priced = isPriced(f.price);
  return (
    <Panel
      title="כספים"
      description={priced ? <>דמי השתתפות <span className="num">{fmtMoney(f.price)}</span>{f.has_payment_link ? ' · עם קישור לתשלום' : ' · בלי קישור לתשלום (משלמים בכניסה)'}</> : 'מפגש בלי דמי השתתפות'}
      actions={
        <>
          {priced && i.pending_count > 0 && onUnpaid && <Button size="sm" variant="ghost" icon="filter" onClick={onUnpaid}>מי עוד לא שילמו</Button>}
          {onExpenses && <Button size="sm" variant="ghost" icon="task" onClick={onExpenses}>הוצאות</Button>}
        </>
      }
    >
      <section aria-label="כספים" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {priced && (
          <>
            <BigStat label="צפי הכנסות" value={fmtMoney(i.expected)} sub="מה שנגבה ועוד מה שנרשמים חייבים" />
            <BigStat
              label="נגבה"
              value={fmtMoney(i.collected)}
              sub={<><span className="num">{i.paid_count}</span> שילמו{i.waived_count ? <> · <span className="num">{i.waived_count}</span> פטורים</> : null}{i.refunded_count ? <> · <span className="num">{i.refunded_count}</span> הוחזרו</> : null}</>}
            />
            <BigStat label="ממתין לתשלום" value={fmtMoney(i.pending_amount)} sub={<><span className="num">{i.pending_count}</span> רשומים עוד לא שילמו</>} />
          </>
        )}
        {!priced && i.collected > 0 && <BigStat label="נגבה" value={fmtMoney(i.collected)} />}
        <BigStat
          label="הוצאות"
          value={fmtMoney(f.expenses.total)}
          sub={f.expenses.count ? <>שולם <span className="num">{fmtMoney(f.expenses.paid)}</span>{f.expenses.unpaid > 0 ? <> · נותר <span className="num">{fmtMoney(f.expenses.unpaid)}</span></> : null}</> : 'עוד לא נרשמו הוצאות'}
        />
        <BigStat
          label="נטו"
          value={<span className={f.net < 0 ? 'text-bad' : undefined}>{fmtMoney(f.net)}</span>}
          sub={<>נגבה פחות הוצאות ששולמו · צפי <span className="num" dir="ltr">{fmtMoney(f.projected_net)}</span></>}
        />
      </section>
    </Panel>
  );
}
