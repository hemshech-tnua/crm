import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { Button, EmptyState, ErrorBox, PageHeader, Panel, Skeleton, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { rosterDetails, type RosterStats } from './roster';
import { EngagementBadge, PhoneText, ago } from './shared';

type Side = { id: string; full_name: string; phone: string | null; city: string | null; created_at: string };
type Pair = { a: Side; b: Side; similarity: number };

/** More history wins; with equal history, the older card. */
function suggestedKeep(p: Pair, stats: Map<string, RosterStats | null>): string {
  const sa = stats.get(p.a.id)?.attended_count ?? 0;
  const sb = stats.get(p.b.id)?.attended_count ?? 0;
  if (sa !== sb) return sa > sb ? p.a.id : p.b.id;
  return p.a.created_at <= p.b.created_at ? p.a.id : p.b.id;
}

export function DuplicatesPage() {
  const pairs = useQuery({
    queryKey: ['participants', 'duplicates'],
    queryFn: async () => must(await supabase.rpc('staff_find_duplicates')) as Pair[],
  });
  const ids = useMemo(() => [...new Set((pairs.data ?? []).flatMap((p) => [p.a.id, p.b.id]))], [pairs.data]);
  const stats = useQuery({
    queryKey: ['participants', 'duplicates', 'stats', ids],
    enabled: ids.length > 0,
    queryFn: async () => new Map((await rosterDetails(ids)).map((r) => [r.id, r.stats])),
  });

  return (
    <div>
      <PageHeader
        title="כפילויות אפשריות"
        back={{ to: '/app/participants', label: 'לכל הלוחמים' }}
        subtitle="כרטיסים עם שם דומה מאוד. לרוב זה אותו אדם שנרשם עם מספר טלפון אחר."
      />
      {pairs.isError ? (
        <ErrorBox error={errorMessage(pairs.error)} onRetry={() => pairs.refetch()} />
      ) : pairs.isLoading ? (
        <Panel><Skeleton lines={6} /></Panel>
      ) : !pairs.data?.length ? (
        <Panel><EmptyState icon="checkCircle" title="לא נמצאו כפילויות">אין כרגע כרטיסים עם שמות דומים. כדאי לבדוק שוב מדי פעם.</EmptyState></Panel>
      ) : (
        <>
          <p className="mb-3 text-[0.95rem] text-ink-soft">
            <span className="num font-semibold text-ink">{pairs.data.length}</span> זוגות לבדיקה. בוחרים איזה כרטיס להשאיר ולוחצים "מיזוג". אם אלה שני אנשים שונים, פשוט ממשיכים הלאה.
          </p>
          <ul className="flex flex-col gap-4">
            {pairs.data.map((p) => (
              <PairCard key={`${p.a.id}-${p.b.id}`} pair={p} stats={stats.data} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PairCard({ pair, stats }: { pair: Pair; stats?: Map<string, RosterStats | null> }) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<string | null>(null);
  const keep = chosen ?? (stats ? suggestedKeep(pair, stats) : pair.a.id);
  const kept = keep === pair.a.id ? pair.a : pair.b;
  const gone = keep === pair.a.id ? pair.b : pair.a;

  const merge = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('staff_merge_participants', { p_keep: kept.id, p_merge: gone.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participants'] });
      qc.invalidateQueries({ queryKey: ['participant', kept.id] });
      qc.removeQueries({ queryKey: ['participant', gone.id] });
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      toast.success(`הכרטיסים מוזגו לכרטיס של ${kept.full_name}`, { label: 'לכרטיס', run: () => navigate(`/app/participants/${kept.id}`) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ask = async () => {
    const ok = await confirm({
      title: 'למזג את שני הכרטיסים?',
      danger: true,
      confirm: 'מיזוג',
      cancel: 'חזרה',
      body: (
        <div className="flex flex-col gap-2.5">
          <p>
            נשאר: <strong className="text-ink">{kept.full_name}</strong> (<PhoneText phone={kept.phone} />).
          </p>
          <p>
            ההרשמות וההגעות, המשובים, משימות המעקב ויומן השיחות של <strong className="text-ink">{gone.full_name}</strong> עוברים לכרטיס שנשאר.
            פרטים שחסרים בכרטיס שנשאר (עיר, גיל, עיסוק, מקור) יושלמו מהכרטיס השני.
          </p>
          <p>הכרטיס השני והטלפון שלו יימחקו. <strong className="text-bad">אי אפשר לבטל את המיזוג.</strong></p>
        </div>
      ),
    });
    if (ok) merge.mutate();
  };

  return (
    <li className="rounded-[var(--radius-panel)] border border-line-soft bg-paper">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5 text-sm text-muted sm:px-5">
        <span>דמיון בשם: <span className="num font-semibold text-ink">{Math.round(pair.similarity * 100)}%</span></span>
        <span>איזה כרטיס להשאיר?</span>
      </div>
      <fieldset className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4" disabled={merge.isPending}>
        <legend className="sr-only">בחירת הכרטיס שנשאר</legend>
        {[pair.a, pair.b].map((s) => (
          <SideCard key={s.id} side={s} stats={stats?.get(s.id)} keep={keep === s.id} onKeep={() => setChosen(s.id)} name={`keep-${pair.a.id}-${pair.b.id}`} />
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-4 py-3 sm:px-5">
        <Button icon="merge" busy={merge.isPending} onClick={ask}>מיזוג</Button>
        <span className="text-sm text-muted">הכרטיס של {gone.full_name} יתמזג לתוך הכרטיס של {kept.full_name}.</span>
      </div>
    </li>
  );
}

function SideCard({ side, stats, keep, onKeep, name }: { side: Side; stats?: RosterStats | null; keep: boolean; onKeep: () => void; name: string }) {
  return (
    <label className={cx(
      'flex cursor-pointer flex-col gap-1.5 rounded-[var(--radius-control)] border-2 p-3.5 transition-colors',
      keep ? 'border-tide bg-tide-wash/50' : 'border-line-soft hover:border-line',
    )}>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <input type="radio" name={name} checked={keep} onChange={onKeep} className="h-5 w-5 accent-tide" />
          <span className="font-bold">{side.full_name}</span>
        </span>
        {keep ? <span className="text-sm font-semibold text-tide">נשאר</span> : <span className="text-sm text-muted">יתמזג</span>}
      </span>
      <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <span className="text-muted">טלפון</span><span><PhoneText phone={side.phone} /></span>
        <span className="text-muted">עיר</span><span>{side.city ?? <span className="text-faint">—</span>}</span>
        <span className="text-muted">נוצר</span><span><span className="num">{fmtDate(side.created_at)}</span></span>
        <span className="text-muted">הגעות</span>
        <span className="flex items-center gap-2">
          <span className="num font-semibold">{stats?.attended_count ?? 0}</span>
          {stats?.last_attended_at && <span className="text-muted">אחרון {ago(stats.last_attended_at)}</span>}
          <EngagementBadge status={stats?.engagement_status} />
        </span>
      </span>
      <Link to={`/app/participants/${side.id}`} className="inline-flex items-center gap-1 self-start text-sm font-medium text-tide hover:underline" onClick={(e) => e.stopPropagation()}>
        <Icon name="external" size={14} />
        פתיחת הכרטיס
      </Link>
    </label>
  );
}
