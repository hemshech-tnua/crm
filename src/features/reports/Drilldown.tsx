import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { fmtDate, fmtListDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { ENGAGEMENT_LABEL } from '@/lib/labels';
import type { Engagement, PaymentMethod, PaymentStatus } from '@/lib/types';
import { Dialog } from '@/ui/feedback';
import { Badge, Button, EmptyState, ErrorBox, Skeleton } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { PaymentDialog, type PaymentTarget } from '@/features/events/finance';
import { chunk } from '@/features/events/queries';
import { rpcArgs, type Filters } from './period';

export type DrillKind = 'attendees' | 'new' | 'returning' | 'friend_new';
const TITLES: Record<DrillKind, string> = {
  attendees: 'מי הגיע בתקופה',
  new: 'חדשים בתקופה',
  returning: 'הגיעו ליותר ממפגש אחד',
  friend_new: 'חדשים שהגיעו דרך חבר',
};

type Row = { id: string; full_name: string; phone: string; city: string | null; source_label: string | null; attended_count: number; first_attended_at: string; last_attended_at: string; engagement_status: Engagement };

/** The people behind a number: every KPI on the dashboard opens the list that makes it up. */
export function Drilldown({ kind, filters, onClose }: { kind: DrillKind | null; filters: Filters; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['drilldown', kind, filters],
    enabled: !!kind,
    queryFn: async () => must(await supabase.rpc('report_drilldown', { p_kind: kind, ...rpcArgs(filters) })) as Row[],
  });
  return (
    <Dialog open={!!kind} onClose={onClose} title={kind ? `${TITLES[kind]}${q.data ? ` (${q.data.length})` : ''}` : ''} size="lg">
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorBox error={errorMessage(q.error)} /> : !q.data?.length ? (
        <EmptyState icon="people" title="אין אנשים ברשימה הזו">בתקופה ובסוג הפעילות שנבחרו.</EmptyState>
      ) : (
        <ul className="divide-y divide-edge">
          {q.data.map((r) => (
            <li key={r.id}>
              <Link to={`/app/participants/${r.id}`} onClick={onClose} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-mist/60">
                <span className="min-w-36 flex-1 font-semibold">{r.full_name}</span>
                <span className="num text-small text-muted">{formatPhone(r.phone)}</span>
                <span className="text-small text-muted">{r.city ?? ''}</span>
                <span className="text-small text-muted">{r.source_label ?? 'מקור לא ידוע'}</span>
                <span className="text-small">מפגשים: <span className="num font-semibold">{r.attended_count}</span></span>
                <span className="text-small text-muted">אחרון: <span className="num">{fmtDate(r.last_attended_at)}</span></span>
                <Badge tone={r.engagement_status === 'regular' ? 'light' : r.engagement_status === 'lapsed' ? 'warn' : 'neutral'} icon={r.engagement_status === 'lapsed' ? 'alert' : undefined}>{ENGAGEMENT_LABEL[r.engagement_status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ───────────── who has not paid (the finance report's "ממתין לתשלום" tile) ─────────────

type UnpaidRow = {
  id: string; payment_status: PaymentStatus; paid_amount: number | null; payment_method: PaymentMethod | null; payment_ref: string | null;
  participant: { id: string; full_name: string | null; phone: string | null; anonymized_at: string | null } | null;
  event: { id: string; title: string; starts_at: string; price: number | null; type: string; site_id: string | null; status: string };
};

/**
 * The registrations behind "ממתין לתשלום", across meetings: registered, fee not paid and not marked absent, in a
 * priced meeting of the period (the rule of private.event_finance). Grouped by meeting, with "סימון תשלום" per person.
 */
export function UnpaidDrilldown({ open, filters, eventIds, onClose }: {
  open: boolean; filters: Filters;
  /** the meetings of the finance report, so the list and the tile count the same registrations */
  eventIds: string[];
  onClose: () => void;
}) {
  const [paying, setPaying] = useState<{ target: PaymentTarget; event: { id: string; price: number | null } } | null>(null);
  const q = useQuery({
    // under ['event_payments', 'summary']: marking a payment refreshes this list with the report
    queryKey: ['event_payments', 'summary', 'unpaid', filters, eventIds],
    enabled: open,
    queryFn: async () => {
      const parts = await Promise.all(chunk(eventIds).map(async (ids) => must(await supabase
        .from('registrations')
        .select('id, payment_status, paid_amount, payment_method, payment_ref,'
          + ' participant:participants!registrations_participant_id_fkey(id, full_name, phone, anonymized_at),'
          + ' event:events!inner(id, title, starts_at, price, type, site_id, status)')
        .in('event_id', ids)
        .eq('status', 'registered').eq('payment_status', 'pending').neq('attendance', 'no_show')) as unknown as UnpaidRow[]));
      return parts.flat();
    },
  });
  const groups = useMemo(() => {
    const m = new Map<string, { event: UnpaidRow['event']; rows: UnpaidRow[] }>();
    for (const r of q.data ?? []) {
      const g = m.get(r.event.id) ?? { event: r.event, rows: [] };
      g.rows.push(r);
      m.set(r.event.id, g);
    }
    return [...m.values()]
      .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at))
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (a.participant?.full_name ?? '').localeCompare(b.participant?.full_name ?? '', 'he')) }));
  }, [q.data]);
  const count = q.data?.length ?? 0;
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.event.price ?? 0), 0);

  return (
    <>
      <Dialog open={open && !paying} onClose={onClose} title={q.data ? `לא שילמו (${count})` : 'לא שילמו'} size="lg">
        {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !count ? (
          <EmptyState icon="checkCircle" title="כל הרשומים שילמו">אין תשלום שממתין בתקופה ובסוג הפעילות שנבחרו.</EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-small text-muted">
              ממתין לתשלום: <span className="num font-bold text-ink">{fmtMoney(total)}</span> מ-<span className="num">{count}</span> רשומים
              ב-<span className="num">{groups.length}</span> {groups.length === 1 ? 'מפגש' : 'מפגשים'}. מי שסומנה לו אי־הגעה לא נספר.
            </p>
            {groups.map((g) => (
              <section key={g.event.id} aria-label={g.event.title}>
                <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-edge pb-2">
                  <div className="min-w-0">
                    <Link to={`/app/events/${g.event.id}?tab=registrations&filter=unpaid`} onClick={onClose} className="font-bold hover:text-tide hover:underline">{g.event.title}</Link>
                    <div className="text-small text-muted">
                      <span className="tabular-nums">{fmtListDate(g.event.starts_at, { time: false })}</span> · <span className="num">{g.rows.length}</span> לא שילמו · <span className="num">{fmtMoney(Number(g.event.price ?? 0) * g.rows.length)}</span>
                    </div>
                  </div>
                  <Link to={`/app/events/${g.event.id}?tab=messages&group=unpaid`} onClick={onClose} className="inline-flex min-h-11 items-center gap-1.5 text-small font-semibold text-tide hover:underline">
                    <Icon name="message" size={16} />תזכורת תשלום בוואטסאפ
                  </Link>
                </header>
                <ul className="divide-y divide-edge">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                      <span className="min-w-36 flex-1">
                        {r.participant && !r.participant.anonymized_at
                          ? <Link to={`/app/participants/${r.participant.id}`} onClick={onClose} className="font-semibold hover:text-tide hover:underline">{r.participant.full_name}</Link>
                          : <span className="font-semibold text-muted">פרטים נמחקו</span>}
                        {r.participant?.phone && !r.participant.anonymized_at && <span className="num mr-3 text-small text-muted" dir="ltr">{formatPhone(r.participant.phone)}</span>}
                      </span>
                      <span className="num text-small">{fmtMoney(r.event.price)}</span>
                      <Button size="sm" variant="secondary" icon="check" onClick={() => setPaying({
                        target: { id: r.id, name: r.participant?.full_name ?? null, payment_status: r.payment_status, paid_amount: r.paid_amount, payment_method: r.payment_method, payment_ref: r.payment_ref },
                        event: { id: r.event.id, price: r.event.price },
                      })}>סימון תשלום</Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Dialog>
      <PaymentDialog target={paying?.target ?? null} event={paying?.event ?? { id: '', price: null }} onClose={() => setPaying(null)} />
    </>
  );
}
