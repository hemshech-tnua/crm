// Payments from "יש חשבונית" that the webhook could not match to a pending registration (migration
// 20261106002700_pay_before_register.sql): the team matches each one to the right registration (which marks it paid
// and registers it) or takes it off the list. On a meeting's registrations tab the choices are that meeting's
// registrations; in the finance report, registrations across meetings (same phone first).
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { fmtListDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { formatPhone } from '@/lib/phone';
import { REG_STATUS_LABEL } from '@/lib/labels';
import type { RegStatus } from '@/lib/types';
import { Badge, Button, ErrorBox, Panel, SearchInput, Skeleton, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { useInvalidateEvent } from './queries';
import { SEARCH_PLACEHOLDER, matchesSearch } from '@/ui/search';

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

/** The fee of each meeting a candidate belongs to: "same amount" is the strongest hint after the phone. */
function usePrices(list: UnmatchedPayment[] | undefined) {
  const ids = useMemo(() => [...new Set((list ?? []).flatMap((p) => p.candidates.map((c) => c.event_id)))].sort(), [list]);
  return useQuery({
    queryKey: ['unmatched-payments', 'prices', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = must(await supabase.from('events').select('id, price').in('id', ids.slice(0, 150))) as { id: string; price: number | null }[];
      return new Map(rows.map((r) => [r.id, r.price == null ? null : Number(r.price)]));
    },
  });
}

const FIRST = 3;

/**
 * The work list. On a meeting (`eventId`) it is one line until opened, and nothing when there is nothing to match;
 * in the finance report it shows the first three, and nothing when the list is empty.
 */
export function UnmatchedPayments({ eventId = null }: { eventId?: string | null }) {
  const q = useUnmatchedPayments(eventId);
  const prices = usePrices(q.data);
  const [open, setOpen] = useState(!eventId);
  const [all, setAll] = useState(false);
  const n = q.data?.length ?? 0;
  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!n) return null;

  const title = n === 1 ? 'תשלום אחד מחכה להתאמה' : `${n} תשלומים מחכים להתאמה`;
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-control)] border-s-[3px] border-warn bg-warn-wash px-3.5 py-2 text-sm text-warn" data-testid="unmatched-banner">
        <Icon name="alert" size={18} />
        <span className="flex-1 font-medium">
          <span className="font-bold">{title}</span>: שולמו ב"יש חשבונית" ולא נמצאה להם הרשמה באותו טלפון.
        </span>
        <Button size="sm" variant="secondary" cta onClick={() => setOpen(true)}>להתאמה</Button>
      </div>
    );
  }
  const shown = all ? q.data! : q.data!.slice(0, FIRST);
  return (
    <Panel
      title={title}
      description='שולמו ב"יש חשבונית" ולא נמצאה להם הרשמה באותו טלפון. מתאימים כל תשלום להרשמה, וההרשמה מושלמת.'
      actions={eventId ? <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>הסתרה</Button> : undefined}
    >
      {q.isLoading ? (
        <Skeleton lines={3} />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-edge" aria-label="תשלומים שמחכים להתאמה">
            {shown.map((p) => <PaymentRow key={p.id} p={p} eventId={eventId} prices={prices.data} />)}
          </ul>
          {n > FIRST && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAll((x) => !x)}>
              {all ? 'הצגת שלושה בלבד' : `עוד ${n - FIRST} תשלומים`}
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}

function candidateWhere(c: Candidate, withEvent: boolean): string {
  const where = withEvent ? `${c.event_title} · ${fmtListDate(c.starts_at, { time: false })}` : '';
  // the status only when it is not the usual "waiting for the payment"
  const status = c.status === 'pending_payment' ? '' : REG_STATUS_LABEL[c.status];
  return [where, status].filter(Boolean).join(' · ');
}

function PaymentRow({ p, eventId, prices }: { p: UnmatchedPayment; eventId: string | null; prices?: Map<string, number | null> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateEvent();
  // preselect only a registration whose phone matches the payment; otherwise the team has to choose one explicitly
  const [pick, setPick] = useState(p.candidates.find((c) => c.phone_match)?.registration_id ?? '');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState(false);
  const chosen = p.candidates.find((c) => c.registration_id === pick);

  const sameAmount = (c: Candidate) => {
    const price = prices?.get(c.event_id);
    return price != null && Number(price) === Number(p.amount);
  };
  // the likeliest first: same phone, then the meeting's fee equals the amount, then the meeting nearest the payment
  const ranked = useMemo(() => {
    const paid = new Date(p.paid_at).getTime();
    const score = (c: Candidate) => (c.phone_match ? 0 : 2) + (sameAmount(c) ? 0 : 1);
    return [...p.candidates].sort((a, b) =>
      score(a) - score(b) || Math.abs(new Date(a.starts_at).getTime() - paid) - Math.abs(new Date(b.starts_at).getTime() - paid)
      || (a.full_name ?? '').localeCompare(b.full_name ?? '', 'he'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, prices]);
  const term = search.trim();
  const filtered = term ? ranked.filter((c) => matchesSearch(term, { name: c.full_name, phone: c.phone, also: [c.event_title] })) : ranked;
  const LIMIT = 4;
  const visible = more || term ? [...filtered] : filtered.slice(0, LIMIT);
  // the chosen one stays on screen even when the search hides it
  if (chosen && !visible.includes(chosen)) visible.unshift(chosen);

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
      const who = c.full_name ?? '';
      toast.success(status === 'waitlisted'
        ? `התשלום של ${who} הותאם. המפגש מלא, ההרשמה ברשימת המתנה`
        : `התשלום של ${who} הותאם, ההרשמה הושלמה`);
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
      body: <>לתשלום הזה לא תותאם הרשמה (למשל, הוא לא על מפגש). התשלום עצמו לא מוחזר מכאן: החזר עושים ב"יש חשבונית".</>,
      confirm: 'הסרה מהרשימה',
      cancel: 'חזרה',
    });
    if (ok) dismiss.mutate();
  };

  const name = `match-${p.id}`;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" data-testid="unmatched-payment">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="font-bold">
            <span className="num">{fmtMoney(p.amount)}</span>
            {p.customer_name && <> · {p.customer_name}</>}
          </div>
          <div className="text-small text-ink-soft">
            {p.phone && <><span dir="ltr" className="num">{formatPhone(p.phone)}</span> · </>}
            <span className="tabular-nums whitespace-nowrap">{fmtListDate(p.paid_at)}</span> · קבלה <span className="num break-all">{p.doc_number}</span>
          </div>
        </div>
      </div>
      {p.candidates.length ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1.5 text-small font-medium">התאמה להרשמה</legend>
          {p.candidates.length > LIMIT && (
            <SearchInput value={search} onChange={setSearch} placeholder={SEARCH_PLACEHOLDER} label="חיפוש הרשמה להתאמה" />
          )}
          <div className="flex flex-col gap-1.5">
            {visible.map((c) => {
              const on = c.registration_id === pick;
              const where = candidateWhere(c, !eventId);
              return (
                <label
                  key={c.registration_id}
                  className={cx(
                    'flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 transition-colors',
                    on ? 'border-ink bg-ink/[0.04]' : 'border-edge hover:border-ink',
                  )}
                >
                  <input type="radio" name={name} value={c.registration_id} checked={on} onChange={() => setPick(c.registration_id)} className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.full_name ?? 'פרטים נמחקו'}</span>
                    <span className="block truncate text-small text-muted">
                      {c.phone && <span className="num" dir="ltr">{formatPhone(c.phone)}</span>}
                      {c.phone && where && ' · '}{where}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {c.phone_match && <Badge tone="tide">אותו טלפון</Badge>}
                    {sameAmount(c) && <Badge tone="neutral">אותו סכום</Badge>}
                  </span>
                </label>
              );
            })}
            {term && !filtered.length && <p className="text-small text-muted">אין הרשמה שמתאימה לחיפוש.</p>}
          </div>
          {!term && filtered.length > LIMIT && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setMore((x) => !x)}>
              {more ? 'פחות אפשרויות' : `עוד ${filtered.length - LIMIT} הרשמות`}
            </Button>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <Button icon="check" busy={attach.isPending} disabled={!chosen} onClick={() => chosen && attach.mutate(chosen)}>התאמה</Button>
            <Button variant="ghost" busy={dismiss.isPending} onClick={askDismiss}>הסרה מהרשימה</Button>
          </div>
        </fieldset>
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
