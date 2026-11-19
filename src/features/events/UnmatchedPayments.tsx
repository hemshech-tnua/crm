// Payments from "יש חשבונית" that the webhook could not match to a pending registration (migration
// 20261106002700_pay_before_register.sql): the team attaches each one to the right registration (which marks it paid
// and registers it) or takes it off the list. On a meeting's registrations tab the choices are that meeting's
// registrations; in the finance report, registrations across meetings (same phone first).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtDateTime, fmtDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { formatPhone } from '@/lib/phone';
import { REG_STATUS_LABEL } from '@/lib/labels';
import type { RegStatus } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, Panel, Select, Skeleton } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { useInvalidateEvent } from './queries';

type Candidate = {
  registration_id: string; event_id: string; event_title: string; starts_at: string;
  full_name: string | null; phone: string | null; status: RegStatus; payment_status: string; phone_match: boolean;
};
export type UnmatchedPayment = {
  id: string; doc_number: string; amount: number; paid_at: string; received_at: string;
  customer_name: string | null; phone: string | null; candidates: Candidate[];
};

export const unmatchedKey = (eventId: string | null) => ['unmatched-payments', eventId ?? 'all'] as const;

export const useUnmatchedPayments = (eventId: string | null) =>
  useQuery({
    queryKey: unmatchedKey(eventId),
    queryFn: async () => must(await supabase.rpc('staff_unmatched_payments', { p_event_id: eventId })) as UnmatchedPayment[],
  });

/**
 * The list. With an event, it shows only when there is something to resolve; without one (the finance report), always.
 */
export function UnmatchedPayments({ eventId = null }: { eventId?: string | null }) {
  const q = useUnmatchedPayments(eventId);
  if (eventId && !q.data?.length) return null;
  return (
    <Panel
      title="תשלומים שלא זוהו"
      description='תשלומים שהגיעו מ"יש חשבונית" בלי הרשמה ממתינה באותו טלפון. משייכים כל תשלום להרשמה הנכונה, וההרשמה מושלמת.'
    >
      {q.isLoading ? (
        <Skeleton lines={3} />
      ) : q.isError ? (
        <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon="checkCircle" title="אין תשלומים לשיוך">כל התשלומים שהגיעו שויכו להרשמות.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-edge" aria-label="תשלומים שלא זוהו">
          {q.data.map((p) => <PaymentRow key={p.id} p={p} eventId={eventId} />)}
        </ul>
      )}
    </Panel>
  );
}

function candidateLabel(c: Candidate, withEvent: boolean): string {
  // short enough for a phone: the status only when it is not the usual "waiting for the payment"
  const who = [c.full_name ?? 'פרטים נמחקו', c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(' · ');
  const where = withEvent ? ` · ${c.event_title} ${fmtDate(c.starts_at)}` : '';
  return `${who}${where}${c.status === 'pending_payment' ? '' : ` (${REG_STATUS_LABEL[c.status]})`}`;
}

function PaymentRow({ p, eventId }: { p: UnmatchedPayment; eventId: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateEvent();
  // preselect only a registration whose phone matches the payment; otherwise the team has to choose one explicitly
  const [pick, setPick] = useState(p.candidates.find((c) => c.phone_match)?.registration_id ?? '');
  const chosen = p.candidates.find((c) => c.registration_id === pick);

  const refresh = async (event?: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['unmatched-payments'] }),
      qc.invalidateQueries({ queryKey: ['attention'] }),
      event ? invalidate(event) : Promise.resolve(),
    ]);
  };

  const attach = useMutation({
    mutationFn: async (c: Candidate) => {
      const { data, error } = await supabase.rpc('staff_attach_payment', { p_payment_id: p.id, p_registration_id: c.registration_id });
      if (error) throw error;
      return { c, status: (data as { status: RegStatus }).status };
    },
    onSuccess: async ({ c, status }) => {
      await refresh(c.event_id);
      toast.success(status === 'waitlisted'
        ? `התשלום שויך ל${c.full_name ?? ''}, אבל המפגש מלא: ההרשמה ברשימת ההמתנה ונפתחה משימה.`
        : `התשלום שויך ל${c.full_name ?? ''} וההרשמה הושלמה`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('staff_dismiss_payment', { p_payment_id: p.id, p_note: null });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success('התשלום הוסר מהרשימה');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const askDismiss = async () => {
    const ok = await confirm({
      title: 'להסיר את התשלום מהרשימה?',
      body: <>לתשלום הזה לא תשויך הרשמה (למשל, הוא לא על מפגש). התשלום עצמו לא מוחזר מכאן: החזר עושים ב"יש חשבונית".</>,
      confirm: 'הסרה מהרשימה',
      cancel: 'חזרה',
    });
    if (ok) dismiss.mutate();
  };

  return (
    <li className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0" data-testid="unmatched-payment">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="font-bold">
            <span className="num">{fmtMoney(p.amount)}</span>
            {p.customer_name && <> · {p.customer_name}</>}
          </div>
          {p.phone && <div className="text-small text-ink-soft"><span dir="ltr" className="num">{formatPhone(p.phone)}</span></div>}
          <div className="text-small text-ink-soft">
            קבלה <span className="num break-all">{p.doc_number}</span> · <span className="num whitespace-nowrap">{fmtDateTime(p.paid_at)}</span>
          </div>
        </div>
        {p.candidates.some((c) => c.phone_match) && <Badge tone="tide">יש הרשמה באותו טלפון</Badge>}
      </div>
      {p.candidates.length ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Select label="לשייך להרשמה" value={pick} onChange={(x) => setPick(x.target.value)} className="min-w-0 sm:flex-1">
            <option value="">בחירת הרשמה…</option>
            {p.candidates.map((c) => (
              <option key={c.registration_id} value={c.registration_id}>{candidateLabel(c, !eventId)}</option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button icon="check" busy={attach.isPending} disabled={!chosen} onClick={() => chosen && attach.mutate(chosen)}>שיוך</Button>
            <Button variant="ghost" busy={dismiss.isPending} onClick={askDismiss}>הסרה מהרשימה</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-small text-ink-soft">
            {eventId ? 'אין במפגש הזה הרשמה שמחכה לתשלום.' : 'אין הרשמה שמחכה לתשלום באותו טלפון או מהשבועיים האחרונים.'}
          </p>
          <Button variant="ghost" busy={dismiss.isPending} onClick={askDismiss}>הסרה מהרשימה</Button>
        </div>
      )}
    </li>
  );
}
