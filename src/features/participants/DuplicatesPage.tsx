import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { Button, EmptyState, ErrorBox, PageHeader, Panel, SearchInput, Skeleton, Spinner, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { rosterDetails, type RosterStats } from './roster';
import { EngagementBadge, PhoneText, ago, useDebounced } from './shared';
import { formatPhone } from '@/lib/phone';
import { NoResults } from '@/ui/toolbar';
import { SEARCH_PLACEHOLDER, matchesSearch } from '@/ui/search';

type Side = { id: string; full_name: string; phone: string | null; city: string | null; created_at: string };
type Pair = { a: Side; b: Side; similarity: number };

/** More history wins; with equal history, the older card. */
function suggestedKeep(p: Pair, stats: Map<string, RosterStats | null>): string {
  const sa = stats.get(p.a.id)?.attended_count ?? 0;
  const sb = stats.get(p.b.id)?.attended_count ?? 0;
  if (sa !== sb) return sa > sb ? p.a.id : p.b.id;
  return p.a.created_at <= p.b.created_at ? p.a.id : p.b.id;
}

/** Pairs that share a card belong to the same person: one group per connected set of cards. */
function groupPairs(pairs: Pair[]): Pair[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const p of pairs) parent.set(find(p.a.id), find(p.b.id));
  const groups = new Map<string, Pair[]>();
  for (const p of pairs) {
    const k = find(p.a.id);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.values()].sort((x, y) => Math.max(...y.map((p) => p.similarity)) - Math.max(...x.map((p) => p.similarity)));
}

const matches = (s: Side, q: string) => matchesSearch(q, { name: s.full_name, phone: s.phone, also: [s.city] });

export function DuplicatesPage() {
  const pairs = useQuery({
    queryKey: ['participants', 'duplicates'],
    queryFn: async () => must(await supabase.rpc('staff_find_duplicates')) as Pair[],
  });
  // cards merged away on this page: their pairs disappear at once (the list is also fetched again)
  const [goneIds, setGoneIds] = useState<Set<string>>(() => new Set());
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim(), 200);
  const live = useMemo(() => (pairs.data ?? []).filter((p) => !goneIds.has(p.a.id) && !goneIds.has(p.b.id)), [pairs.data, goneIds]);
  const groups = useMemo(() => {
    const all = groupPairs(live);
    if (!q) return all;
    return all.filter((g) => g.some((p) => matches(p.a, q) || matches(p.b, q)));
  }, [live, q]);
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
      {pairs.isError && !pairs.data ? (
        <ErrorBox error={errorMessage(pairs.error)} onRetry={() => pairs.refetch()} />
      ) : pairs.isLoading ? (
        // the check compares every card with every other: it can take a while, so say so instead of a silent skeleton
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-body text-ink-soft" role="status"><Spinner size={16} />בודקים את כל הכרטיסים. זה יכול לקחת כמה שניות.</p>
          <Skeleton shape="rows" count={4} height={150} />
        </div>
      ) : !live.length ? (
        <Panel><EmptyState icon="checkCircle" title="לא נמצאו כפילויות">אין כרגע כרטיסים עם שמות דומים. כדאי לבדוק שוב מדי פעם.</EmptyState></Panel>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-ink-soft">
              <span className="num font-semibold text-ink">{groupPairs(live).length}</span> אנשים לבדיקה. בוחרים איזה כרטיס להשאיר ולוחצים "מיזוג". אם אלה אנשים שונים: "אלה שני אנשים שונים".
            </p>
            <div className="sm:w-80"><SearchInput value={term} onChange={setTerm} label="חיפוש בכפילויות" placeholder={SEARCH_PLACEHOLDER} /></div>
          </div>
          {groups.length === 0 ? (
            <Panel><NoResults onClear={() => setTerm('')} /></Panel>
          ) : (
            <ul className="flex flex-col gap-4">
              {groups.map((g) => (
                <li key={g.map((p) => `${p.a.id}-${p.b.id}`).join('|')}>
                  {g.length > 1 && (
                    <p className="mb-1.5 flex items-center gap-1.5 text-small font-semibold text-ink">
                      <Icon name="people" size={16} />
                      {g[0].a.full_name}: <span className="num">{new Set(g.flatMap((p) => [p.a.id, p.b.id])).size}</span> כרטיסים שאולי של אותו אדם
                    </p>
                  )}
                  <ul className={cx('flex flex-col gap-3', g.length > 1 && 'border-s-2 border-ink/20 ps-3')}>
                    {g.map((p) => (
                      <PairCard key={`${p.a.id}-${p.b.id}`} pair={p} stats={stats.data}
                        onMerged={(gone) => setGoneIds((x) => new Set([...x, gone]))} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PairCard({ pair, stats, onMerged }: { pair: Pair; stats?: Map<string, RosterStats | null>; onMerged: (goneId: string) => void }) {
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
      onMerged(gone.id);
      toast.success(`הכרטיסים מוזגו לכרטיס של ${kept.full_name}`, { label: 'לכרטיס', run: () => navigate(`/app/participants/${kept.id}`) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('staff_dismiss_duplicate', { p_a: pair.a.id, p_b: pair.b.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participants', 'duplicates'] });
      toast.success(`${pair.a.full_name} ו${pair.b.full_name} סומנו כשני אנשים שונים`);
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
          <p>
            הכרטיס של {gone.full_name} יימחק, ואיתו הטלפון <strong className="num text-ink" dir="ltr">{formatPhone(gone.phone)}</strong>. בכרטיס שנשאר יישאר רק הטלפון <span className="num" dir="ltr">{formatPhone(kept.phone)}</span>.
            אם צריך את המספר השני, כדאי לרשום אותו קודם בהערות של הכרטיס שנשאר.
          </p>
          <p><strong className="text-bad">אי אפשר לבטל את המיזוג.</strong></p>
        </div>
      ),
    });
    if (ok) merge.mutate();
  };

  return (
    <li className="rounded-[var(--radius-panel)] border border-edge bg-paper" data-testid="duplicate-pair">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-2.5 text-small text-muted sm:px-5">
        <span>דמיון בשם: <span className="num font-semibold text-ink">{Math.round(pair.similarity * 100)}%</span></span>
        <span>איזה כרטיס להשאיר?</span>
      </div>
      <fieldset className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4" disabled={merge.isPending}>
        <legend className="sr-only">בחירת הכרטיס שנשאר</legend>
        {[pair.a, pair.b].map((s) => (
          <SideCard key={s.id} side={s} stats={stats?.get(s.id)} keep={keep === s.id} onKeep={() => setChosen(s.id)} name={`keep-${pair.a.id}-${pair.b.id}`} />
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 border-t border-edge px-4 py-3 sm:px-5">
        <Button icon="merge" busy={merge.isPending} disabled={dismiss.isPending} onClick={ask}>מיזוג</Button>
        <Button variant="ghost" busy={dismiss.isPending} disabled={merge.isPending} onClick={() => dismiss.mutate()}>אלה שני אנשים שונים</Button>
        <span className="text-small text-muted">במיזוג, הכרטיס של {gone.full_name} (<PhoneText phone={gone.phone} />) יתמזג לתוך הכרטיס של {kept.full_name} (<PhoneText phone={kept.phone} />).</span>
      </div>
    </li>
  );
}

function SideCard({ side, stats, keep, onKeep, name }: { side: Side; stats?: RosterStats | null; keep: boolean; onKeep: () => void; name: string }) {
  return (
    <label className={cx(
      'flex cursor-pointer flex-col gap-1.5 rounded-[var(--radius-control)] border-2 p-3.5 transition-colors',
      keep ? 'border-ink bg-paper' : 'border-edge bg-paper hover:border-control-line',
    )}>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <input type="radio" name={name} checked={keep} onChange={onKeep} className="h-5 w-5 accent-tide" />
          <span className="font-bold">{side.full_name}</span>
        </span>
        {keep ? <span className="text-small font-semibold text-tide">נשאר</span> : <span className="text-small text-muted">יתמזג</span>}
      </span>
      <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-small">
        <span className="text-muted">טלפון</span><span><PhoneText phone={side.phone} /></span>
        <span className="text-muted">עיר</span><span>{side.city ?? <span className="text-faint">—</span>}</span>
        <span className="text-muted">נוצר</span><span><span className="num">{fmtDate(side.created_at)}</span></span>
        <span className="text-muted">הגעות</span>
        <span className="flex items-center gap-2">
          <span className="num font-semibold">{stats?.attended_count ?? 0}</span>
          {stats?.last_attended_at && <span className="text-muted">הגעה אחרונה {ago(stats.last_attended_at)}</span>}
          <EngagementBadge status={stats?.engagement_status} />
        </span>
      </span>
      <Link to={`/app/participants/${side.id}`} className="inline-flex items-center gap-1 self-start text-small font-medium text-tide hover:underline" onClick={(e) => e.stopPropagation()}>
        <Icon name="external" size={14} />
        פתיחת הכרטיס
      </Link>
    </label>
  );
}
