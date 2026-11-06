import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtShortDate } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { FOLLOWUP_TYPE_LABEL } from '@/lib/labels';
import { telLink } from '@/lib/phone';
import { Badge, Button, EmptyState, ErrorBox, IconButton, PageHeader, Panel, Skeleton, Tabs, buttonClass, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { PersonLink, ago, daysUntil, useNextOpenEvent, type EventForMessage } from '@/features/participants/shared';
import {
  CompleteTaskDialog, EditTaskDialog, NewTaskDialog, TASK_SELECT, TaskComposer, useAssignees, useOpenLapsedTask, type TaskRow,
} from './shared';

type Tab = 'mine' | 'open' | 'done';
type Lapsed = { participant_id: string; full_name: string; last_attended_at: string | null; friday_count: number; fridays_missed: number; has_open_task: boolean };
type Attention = { lapsed: Lapsed[] };

const byDue = (a: TaskRow, b: TaskRow) =>
  (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.created_at.localeCompare(b.created_at);

export function FollowUpsPage() {
  const me = useMe();
  const myId = me.data?.user_id;
  const [sp, setSp] = useSearchParams();
  const requested = sp.get('tab') as Tab | null;
  const typeFilter = sp.get('type') as TaskRow['type'] | null;
  const setTab = (t: Tab) => setSp({ tab: t }, { replace: true });
  const setType = (t: string | null) => { const n = new URLSearchParams(sp); if (t) n.set('type', t); else n.delete('type'); setSp(n, { replace: true }); };
  const [creating, setCreating] = useState(false);

  const open = useQuery({
    queryKey: ['followups', 'open'],
    queryFn: async () => must(await supabase.from('follow_ups').select(TASK_SELECT).eq('status', 'open')
      .order('due_date', { ascending: true, nullsFirst: false }).order('created_at').limit(1000)) as unknown as TaskRow[],
  });
  const done = useQuery({
    queryKey: ['followups', 'done'],
    enabled: requested === 'done',
    queryFn: async () => must(await supabase.from('follow_ups').select(TASK_SELECT).in('status', ['done', 'cancelled'])
      .order('completed_at', { ascending: false }).limit(100)) as unknown as TaskRow[],
  });
  const attention = useQuery({
    queryKey: ['attention'],
    queryFn: async () => must(await supabase.rpc('attention_items')) as Attention,
  });
  const next = useNextOpenEvent();

  const allOpen = useMemo(() => [...(open.data ?? [])].sort(byDue), [open.data]);
  const all = useMemo(() => (typeFilter ? allOpen.filter((t) => t.type === typeFilter) : allOpen), [allOpen, typeFilter]);
  const mine = useMemo(() => all.filter((t) => t.assignee_id === myId), [all, myId]);
  // S5: without a chosen tab, open on "mine" only when there is something of mine; otherwise on all open tasks
  const tab: Tab = requested && ['mine', 'open', 'done'].includes(requested) ? requested
    : open.data && !allOpen.some((t) => t.assignee_id === myId) ? 'open' : 'mine';
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allOpen) c[t.type] = (c[t.type] ?? 0) + 1;
    return c;
  }, [allOpen]);
  const lapsed = (attention.data?.lapsed ?? []).filter((l) => !l.has_open_task);

  return (
    <div>
      <PageHeader
        title="מעקב"
        subtitle="שיחות והודעות ללוחמים בין המפגשים"
        actions={<Button icon="plus" onClick={() => setCreating(true)}>משימה חדשה</Button>}
      />

      {tab !== 'done' && lapsed.length > 0 && (
        <button
          type="button"
          onClick={() => document.getElementById('lapsed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="mb-4 flex w-full items-center gap-2.5 rounded-[var(--radius-control)] bg-warn-wash px-4 py-3 text-right text-[0.95rem] font-medium text-warn hover:underline"
        >
          <Icon name="alert" size={18} />
          <span className="flex-1"><span className="num font-bold">{lapsed.length}</span> {lapsed.length === 1 ? 'קבוע/ה שהפסיק/ה להגיע מחכה' : 'קבועים שהפסיקו להגיע מחכים'} להחלטה אם לפנות</span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      <Tabs<Tab>
        label="משימות"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'mine', label: 'שלי', count: open.data ? mine.length : undefined },
          { value: 'open', label: 'פתוחות', count: open.data ? all.length : undefined },
          { value: 'done', label: 'הושלמו' },
        ]}
      />

      {tab !== 'done' && Object.keys(typeCounts).length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="סינון לפי סוג משימה">
          {[{ v: null, l: 'הכול', n: allOpen.length }, ...Object.entries(FOLLOWUP_TYPE_LABEL).filter(([k]) => typeCounts[k]).map(([k, l]) => ({ v: k, l, n: typeCounts[k] }))].map((o) => (
            <button key={o.v ?? 'all'} type="button" aria-pressed={typeFilter === o.v} onClick={() => setType(o.v)}
              className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold ${typeFilter === o.v ? 'border-ink bg-ink text-mist' : 'border-line bg-paper text-ink-soft hover:border-tide'}`}>
              {o.l} <span className="num">{o.n}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'done' ? (
        <DoneList q={done} />
      ) : open.isError ? (
        <ErrorBox error={errorMessage(open.error)} onRetry={() => open.refetch()} />
      ) : open.isLoading ? (
        <Panel><Skeleton lines={6} /></Panel>
      ) : (
        <TaskGroups
          tasks={tab === 'mine' ? mine : all}
          nextEvent={next.data}
          showAssignee={tab === 'open'}
          empty={tab === 'mine'
            ? <EmptyState icon="checkCircle" title="אין משימות פתוחות עליך" action={all.length ? <Button variant="secondary" onClick={() => setTab('open')}>לכל המשימות הפתוחות</Button> : undefined}>
                {all.length ? <>יש <span className="num">{all.length}</span> משימות פתוחות של אחרים או בלי אחראי/ת.</> : 'כל הכבוד, הכול מטופל.'}
              </EmptyState>
            : <EmptyState icon="checkCircle" title="אין משימות פתוחות">משימות נפתחות לבד כשסוגרים מפגש (מי שלא הגיע ומי שהגיע/ה בפעם הראשונה), או ידנית.</EmptyState>}
        />
      )}

      {tab !== 'done' && (
        <LapsedSection lapsed={lapsed} loading={attention.isLoading} error={attention.error} onRetry={() => attention.refetch()} />
      )}

      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

// ───────────── open tasks, grouped by urgency ─────────────

function TaskGroups({ tasks, nextEvent, showAssignee, empty }: { tasks: TaskRow[]; nextEvent: EventForMessage | null | undefined; showAssignee: boolean; empty: ReactNode }) {
  const groups = useMemo(() => {
    const g: { key: string; title: string; items: TaskRow[] }[] = [
      { key: 'late', title: 'באיחור', items: [] },
      { key: 'today', title: 'להיום', items: [] },
      { key: 'soon', title: 'הבאות', items: [] },
      { key: 'none', title: 'בלי תאריך יעד', items: [] },
    ];
    for (const t of tasks) {
      const d = t.due_date ? daysUntil(t.due_date) : null;
      g[d == null ? 3 : d < 0 ? 0 : d === 0 ? 1 : 2].items.push(t);
    }
    return g.filter((x) => x.items.length);
  }, [tasks]);
  const [doing, setDoing] = useState<{ kind: 'done' | 'edit' | 'msg'; task: TaskRow } | null>(null);

  if (!tasks.length) return <Panel>{empty}</Panel>;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className={cx('mb-2 flex items-center gap-2 text-sm font-bold', g.key === 'late' ? 'text-bad' : 'text-muted')}>
            {g.title}
            <span className="num rounded-full bg-mist-deep px-1.5 text-xs text-ink-soft">{g.items.length}</span>
          </h2>
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper">
            {g.items.map((t) => (
              <TaskItem key={t.id} task={t} showAssignee={showAssignee} onAct={(kind) => setDoing({ kind, task: t })} />
            ))}
          </ul>
        </section>
      ))}
      {doing?.kind === 'done' && <CompleteTaskDialog task={{ ...doing.task, participantName: doing.task.participant?.full_name }} onClose={() => setDoing(null)} />}
      {doing?.kind === 'edit' && <EditTaskDialog task={doing.task} onClose={() => setDoing(null)} />}
      {doing?.kind === 'msg' && <TaskComposer task={doing.task} nextEvent={nextEvent} onClose={() => setDoing(null)} />}
    </div>
  );
}

function DueText({ date }: { date: string | null }) {
  if (!date) return <span>בלי תאריך יעד</span>;
  const d = daysUntil(date);
  if (d < 0) return <span className="font-semibold text-bad">באיחור של {-d === 1 ? 'יום' : <><span className="num">{-d}</span> ימים</>}</span>;
  if (d === 0) return <span className="font-semibold text-ink">יעד: היום</span>;
  if (d === 1) return <span>יעד: מחר</span>;
  return <span>יעד: <span className="num">{fmtDate(date)}</span></span>;
}

function TaskItem({ task: t, showAssignee, onAct }: { task: TaskRow; showAssignee: boolean; onAct: (k: 'done' | 'edit' | 'msg') => void }) {
  const { name } = useAssignees();
  const late = t.due_date != null && daysUntil(t.due_date) < 0;
  const p = t.participant;
  return (
    <li className={cx('flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between', late && 'border-s-4 border-s-bad')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {p ? <PersonLink id={p.id} name={p.full_name} className="text-[1.05rem]" /> : <span className="text-muted">פרטים נמחקו</span>}
          {!t.title.startsWith(FOLLOWUP_TYPE_LABEL[t.type]) && (
            <Badge tone={t.type === 'lapsed' ? 'warn' : t.type === 'no_show' ? 'neutral' : 'tide'}>{FOLLOWUP_TYPE_LABEL[t.type]}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-[0.95rem] text-ink">{t.title}</p>
        {t.notes && <p className="mt-0.5 whitespace-pre-line text-sm text-ink-soft">{t.notes}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
          <DueText date={t.due_date} />
          {t.event && (
            <>
              <span aria-hidden="true">·</span>
              <Link to={`/app/events/${t.event.id}`} className="hover:text-tide hover:underline">{t.event.title}, <span className="num">{fmtShortDate(t.event.starts_at)}</span></Link>
            </>
          )}
          {showAssignee && (
            <>
              <span aria-hidden="true">·</span>
              <span>{t.assignee_id ? name.get(t.assignee_id) ?? 'איש/אשת צוות' : <span className="text-warn">בלי אחראי/ת</span>}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" icon="check" onClick={() => onAct('done')} className="h-11 sm:h-9">בוצע</Button>
        {p?.phone && (
          <>
            <Button size="sm" variant="secondary" icon="message" onClick={() => onAct('msg')} className="h-11 sm:h-9">וואטסאפ</Button>
            <a href={telLink(p.phone)} className={buttonClass('secondary', 'sm', 'h-11 sm:h-9')} aria-label={`חיוג אל ${p.full_name}`}>
              <Icon name="phone" size={16} />
              <span className="hidden sm:inline">חיוג</span>
            </a>
          </>
        )}
        <IconButton icon="edit" label="עריכה: אחראי/ת, תאריך יעד או ביטול" onClick={() => onAct('edit')} className="h-11 w-11" />
      </div>
    </li>
  );
}

// ───────────── finished ─────────────

function DoneList({ q }: { q: { data?: TaskRow[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const { name } = useAssignees();
  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Panel><Skeleton lines={6} /></Panel>;
  if (!q.data.length) return <Panel><EmptyState icon="task" title="עוד לא הושלמו משימות">משימה שמסמנים "בוצע" עוברת לכאן, עם מה שעלה בשיחה.</EmptyState></Panel>;
  return (
    <>
      <p className="mb-2 text-sm text-muted">100 המשימות האחרונות שהושלמו או בוטלו.</p>
      <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-[var(--radius-panel)] border border-line-soft bg-paper">
        {q.data.map((t) => (
          <li key={t.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {t.participant ? <PersonLink id={t.participant.id} name={t.participant.full_name} /> : <span className="text-muted">פרטים נמחקו</span>}
              <Badge tone={t.status === 'done' ? 'good' : 'neutral'} icon={t.status === 'done' ? 'check' : undefined}>{t.status === 'done' ? 'בוצע' : 'בוטלה'}</Badge>
              <span className="text-sm text-muted">{FOLLOWUP_TYPE_LABEL[t.type]}</span>
            </div>
            <p className="mt-0.5 text-[0.95rem]">{t.title}</p>
            {t.outcome && <p className="mt-1 whitespace-pre-line rounded-[var(--radius-control)] bg-mist px-3 py-2 text-[0.95rem] text-ink-soft">{t.outcome}</p>}
            <p className="mt-1 text-sm text-muted">
              {[t.completed_by ? name.get(t.completed_by) : null, t.completed_at ? fmtDate(t.completed_at) : null].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

// ───────────── lapsed regulars: decide before anyone writes to them ─────────────

function LapsedSection({ lapsed, loading, error, onRetry }: { lapsed: Lapsed[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const openTask = useOpenLapsedTask();
  return (
    <section id="lapsed" className="mt-8 scroll-mt-20">
      <Panel title="קבועים שהפסיקו להגיע" padded={false}>
        <p className="border-b border-line-soft px-4 py-3 text-sm text-ink-soft sm:px-5">
          היו קבועים, ומאז הביקור האחרון התקיימו 3 מפגשי שישי בלי שהגיעו. לפני שפונים אליהם פותחים משימה: זה האישור שמישהו מהצוות ידבר איתם.
        </p>
        {error ? (
          <div className="p-4"><ErrorBox error={errorMessage(error)} onRetry={onRetry} /></div>
        ) : loading ? (
          <div className="p-4"><Skeleton lines={3} /></div>
        ) : !lapsed.length ? (
          <EmptyState icon="checkCircle" title="אין כרגע קבועים שמחכים להחלטה">כל מי שהפסיק/ה להגיע כבר משויך/ת למשימה.</EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft">
            {lapsed.map((l) => (
              <li key={l.participant_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <PersonLink id={l.participant_id} name={l.full_name} />
                  <p className="text-sm text-muted">
                    <span className="num">{l.friday_count}</span> מפגשי שישי · ביקור אחרון {l.last_attended_at ? <span title={fmtDate(l.last_attended_at)}>{ago(l.last_attended_at)}</span> : '—'} · מאז התקיימו <span className="num">{l.fridays_missed}</span> מפגשים
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  className="h-11 self-start sm:h-9 sm:self-auto"
                  busy={openTask.isPending && openTask.variables === l.participant_id}
                  onClick={() => openTask.mutate(l.participant_id)}
                >
                  פתיחת משימה
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
