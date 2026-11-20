import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtShortDate } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import { FOLLOWUP_TYPE_LABEL, UNASSIGNED_LABEL, taskOutcome, taskTitle } from '@/lib/labels';
import { telLink } from '@/lib/phone';
import { Badge, Button, EmptyState, ErrorBox, FilterChips, IconButton, PageHeader, Panel, Skeleton, Tabs, cx } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { PersonLink, ago, daysUntil, useNextOpenEvent, type EventForMessage } from '@/features/participants/shared';
import {
  CompleteTaskDialog, EditTaskDialog, NewTaskDialog, TASK_SELECT, TaskComposer, useAssignees, useInvalidateTasks, useOpenLapsedTask, type TaskRow,
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
  // ?event=<id>: the follow-ups a meeting left behind (linked from the meeting's summary after it is closed)
  const eventFilter = sp.get('event');
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const setTab = (t: Tab) => setParam('tab', t);
  const setType = (t: string | null) => setParam('type', t);
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

  const allOpen = useMemo(() => [...(open.data ?? [])].filter((t) => !eventFilter || t.event_id === eventFilter).sort(byDue), [open.data, eventFilter]);
  const all = useMemo(() => (typeFilter ? allOpen.filter((t) => t.type === typeFilter) : allOpen), [allOpen, typeFilter]);
  const mine = useMemo(() => all.filter((t) => t.assignee_id === myId), [all, myId]);
  // S5: without a chosen tab, open on "mine" only when there is something of mine; otherwise on all open tasks.
  // A meeting's follow-ups open on all of them: right after closing, none has anyone in charge yet.
  const tab: Tab = requested && ['mine', 'open', 'done'].includes(requested) ? requested
    : eventFilter || (open.data && !allOpen.some((t) => t.assignee_id === myId)) ? 'open' : 'mine';
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

      {eventFilter && <EventScope eventId={eventFilter} tasks={all} loading={open.isLoading} onClear={() => setParam('event', null)} />}

      {tab !== 'done' && !eventFilter && lapsed.length > 0 && (
        <button
          type="button"
          onClick={() => document.getElementById('lapsed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="mb-4 flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-control)] border-s-[3px] border-warn bg-warn-wash px-4 py-3 text-right text-body font-medium text-warn hover:underline"
        >
          <Icon name="alert" size={18} />
          <span className="flex-1"><span className="num font-bold">{lapsed.length}</span> {lapsed.length === 1 ? 'כרטיס של הגעה קבועה שנפסקה מחכה' : 'כרטיסים של הגעה קבועה שנפסקה מחכים'} להחלטה אם לפנות</span>
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
        <FilterChips label="סינון לפי סוג משימה" className="mb-4" value={typeFilter ?? ''} onChange={(v) => setType(v || null)}
          options={[{ value: '', label: 'הכול', count: allOpen.length }, ...Object.entries(FOLLOWUP_TYPE_LABEL).filter(([k]) => typeCounts[k]).map(([k, l]) => ({ value: k, label: l, count: typeCounts[k] }))]} />
      )}

      {tab === 'done' ? (
        <DoneList q={{ ...done, data: eventFilter ? done.data?.filter((t) => t.event_id === eventFilter) : done.data }} />
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
                {all.length ? <>יש <span className="num">{all.length}</span> משימות פתוחות של אחרים או בלי אחראי.</> : 'כל הכבוד, הכול מטופל.'}
              </EmptyState>
            : eventFilter
              ? <EmptyState icon="checkCircle" title="אין משימות פתוחות מהמפגש הזה" action={<Button variant="secondary" onClick={() => setParam('event', null)}>לכל המשימות</Button>}>כל משימות המעקב של המפגש טופלו, או שהמפגש עוד לא נסגר.</EmptyState>
              : <EmptyState icon="checkCircle" title="אין משימות פתוחות">משימות נפתחות לבד כשסוגרים מפגש (מי שלא הגיע ומי שהגיע בפעם הראשונה), או ידנית.</EmptyState>}
        />
      )}

      {tab !== 'done' && !eventFilter && (
        <LapsedSection lapsed={lapsed} loading={attention.isLoading} error={attention.error} onRetry={() => attention.refetch()} />
      )}

      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

// ───────────── one meeting's follow-ups ─────────────

/** The head of the list when it shows one meeting's follow-ups: which meeting, and "לקחת את כולן". */
function EventScope({ eventId, tasks, loading, onClear }: { eventId: string; tasks: TaskRow[]; loading: boolean; onClear: () => void }) {
  const me = useMe();
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const fromTask = tasks.find((t) => t.event)?.event;
  const ev = useQuery({
    queryKey: ['events', 'followup-scope', eventId],
    enabled: !fromTask,
    queryFn: async () => must(await supabase.from('events').select('id,title,starts_at').eq('id', eventId).maybeSingle()) as { id: string; title: string; starts_at: string } | null,
  });
  const event = fromTask ?? ev.data;
  const free = tasks.filter((t) => !t.assignee_id);
  // only tasks that are still without anyone in charge: a colleague who took one in the meantime keeps it
  const takeFree = async (ids: string[]): Promise<string[]> => {
    const { data, error } = await supabase.from('follow_ups').update({ assignee_id: me.data!.user_id })
      .in('id', ids).is('assignee_id', null).select('id');
    if (error) throw error;
    return (data ?? []).map((r: { id: string }) => r.id);
  };
  // undo gives back only what this tap took, and only while it is still mine
  const giveBack = async (ids: string[]) => {
    const { error } = await supabase.from('follow_ups').update({ assignee_id: null })
      .in('id', ids).eq('assignee_id', me.data!.user_id);
    if (error) throw error;
  };
  const take = useMutation({
    mutationFn: takeFree,
    onSuccess: (taken) => {
      invalidate();
      if (!taken.length) {
        toast.info('המשימות כבר נלקחו על ידי אחרים מהצוות');
        return;
      }
      toast.undo(taken.length === 1 ? 'המשימה עברה אליך' : `${taken.length} משימות עברו אליך`, () => {
        giveBack(taken).then(() => invalidate(), (e) => toast.error(errorMessage(e)));
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section aria-label="משימות של מפגש אחד" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--radius-panel)] border border-edge border-s-[3px] border-s-ink bg-paper px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-small text-muted">משימות מעקב מהמפגש</p>
        <p className="font-semibold">
          {event ? <Link to={`/app/events/${event.id}`} className="hover:underline">{event.title}, <span className="num">{fmtShortDate(event.starts_at)}</span></Link> : ev.isLoading ? '…' : 'מפגש שלא נמצא'}
          {!loading && <span className="font-normal text-muted"> · <span className="num">{tasks.length}</span> {tasks.length === 1 ? 'פתוחה' : 'פתוחות'}{free.length > 0 && <>, <span className="num">{free.length}</span> בלי אחראי</>}</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {free.length > 0 && me.data && (
          <Button icon="check" busy={take.isPending} onClick={() => take.mutate(free.map((t) => t.id))}>
            {free.length === tasks.length ? 'לקחת את כולן' : <>לקחת את <span className="num">{free.length}</span> שבלי אחראי</>}
          </Button>
        )}
        <Button variant="ghost" icon="close" onClick={onClear}>לכל המשימות</Button>
      </div>
    </section>
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
          <h2 id={`g-${g.key}`} className={cx('mb-2 flex items-center gap-2 text-heading font-semibold', g.key === 'late' ? 'text-bad' : 'text-ink')}>
            {g.key === 'late' && <Icon name="alert" size={16} />}
            {g.title}
            <span className="num text-small font-medium text-muted">({g.items.length})</span>
          </h2>
          <ul className="flex flex-col divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper">
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
          {p ? <PersonLink id={p.id} name={p.full_name} className="text-heading" /> : <span className="text-muted">פרטים נמחקו</span>}
          {!taskTitle(t.title).startsWith(FOLLOWUP_TYPE_LABEL[t.type]) && (
            <Badge tone={t.type === 'lapsed' ? 'warn' : t.type === 'no_show' ? 'neutral' : 'tide'} icon={t.type === 'lapsed' ? 'alert' : undefined}>{FOLLOWUP_TYPE_LABEL[t.type]}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-body text-ink">{taskTitle(t.title)}</p>
        {t.notes && <p className="mt-0.5 whitespace-pre-line text-small text-ink-soft">{t.notes}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-muted">
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
              <span className={t.assignee_id ? undefined : 'text-muted'}>{t.assignee_id ? name.get(t.assignee_id) ?? 'הצוות' : UNASSIGNED_LABEL}</span>
            </>
          )}
        </p>
      </div>
      {/* one quiet "done" per row; the only navy button on the page is "משימה חדשה" */}
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="secondary" icon="check" onClick={() => onAct('done')} className="me-1">בוצע</Button>
        {p?.phone && (
          <>
            <IconButton icon="message" label={`וואטסאפ אל ${p.full_name ?? ''}`} onClick={() => onAct('msg')} />
            <a href={telLink(p.phone)} aria-label={`חיוג אל ${p.full_name}`} title="חיוג"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-ink/[0.07] hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11">
              <Icon name="phone" size={20} />
            </a>
          </>
        )}
        <IconButton icon="edit" label="עריכה: אחראי, תאריך יעד או ביטול" onClick={() => onAct('edit')} />
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
      <p className="mb-2 text-small text-muted">100 המשימות האחרונות שהושלמו או בוטלו.</p>
      <ul className="flex flex-col divide-y divide-edge overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-paper">
        {q.data.map((t) => (
          <li key={t.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {t.participant ? <PersonLink id={t.participant.id} name={t.participant.full_name} /> : <span className="text-muted">פרטים נמחקו</span>}
              <Badge tone={t.status === 'done' ? 'good' : 'neutral'} icon={t.status === 'done' ? 'check' : undefined}>{t.status === 'done' ? 'בוצע' : 'בוטלה'}</Badge>
              <span className="text-small text-muted">{FOLLOWUP_TYPE_LABEL[t.type]}</span>
            </div>
            <p className="mt-0.5 text-body">{taskTitle(t.title)}</p>
            {t.outcome && <p className="mt-1 whitespace-pre-line rounded-[var(--radius-control)] bg-mist px-3 py-2 text-body text-ink-soft">{taskOutcome(t.outcome)}</p>}
            <p className="mt-1 text-small text-muted">
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
        <p className="border-b border-edge px-4 py-3 text-small text-ink-soft sm:px-5">
          היו קבועים, ומאז ההגעה האחרונה התקיימו 3 מפגשי שישי בלי שהגיעו. לפני שפונים אליהם פותחים משימה: זה האישור שמישהו מהצוות ידבר איתם.
        </p>
        {error ? (
          <div className="p-4"><ErrorBox error={errorMessage(error)} onRetry={onRetry} /></div>
        ) : loading ? (
          <div className="p-4"><Skeleton lines={3} /></div>
        ) : !lapsed.length ? (
          <EmptyState icon="checkCircle" title="אין כרגע קבועים שמחכים להחלטה">לכל מי שהפסיק להגיע כבר יש משימה.</EmptyState>
        ) : (
          <ul className="divide-y divide-edge">
            {lapsed.map((l) => (
              <li key={l.participant_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <PersonLink id={l.participant_id} name={l.full_name} />
                  <p className="text-small text-muted">
                    <span className="num">{l.friday_count}</span> מפגשי שישי · הגעה אחרונה {l.last_attended_at ? <span title={fmtDate(l.last_attended_at)}>{ago(l.last_attended_at)}</span> : '—'} · מאז התקיימו <span className="num">{l.fridays_missed}</span> מפגשים
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  className="self-start sm:self-auto"
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
