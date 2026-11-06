import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { fmtDate } from '@/lib/dates';
import { ENGAGEMENT_LABEL } from '@/lib/labels';
import type { Engagement } from '@/lib/types';
import { Dialog } from '@/ui/feedback';
import { Badge, EmptyState, ErrorBox, Skeleton } from '@/ui/kit';
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
        <ul className="divide-y divide-line-soft">
          {q.data.map((r) => (
            <li key={r.id}>
              <Link to={`/app/participants/${r.id}`} onClick={onClose} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-mist/60">
                <span className="min-w-36 flex-1 font-semibold">{r.full_name}</span>
                <span className="num text-sm text-muted">{formatPhone(r.phone)}</span>
                <span className="text-sm text-muted">{r.city ?? ''}</span>
                <span className="text-sm text-muted">{r.source_label ?? 'מקור לא ידוע'}</span>
                <span className="text-sm">מפגשים: <span className="num font-semibold">{r.attended_count}</span></span>
                <span className="text-sm text-muted">אחרון: <span className="num">{fmtDate(r.last_attended_at)}</span></span>
                <Badge tone={r.engagement_status === 'regular' ? 'light' : r.engagement_status === 'lapsed' ? 'warn' : 'neutral'}>{ENGAGEMENT_LABEL[r.engagement_status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
