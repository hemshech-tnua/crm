import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSpeakers, type EventWithStats } from '@/lib/data';
import { ilParts, todayIl } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import type { EventTask } from '@/lib/types';
import { Button, EmptyState, ErrorBox, IconButton, Panel, Skeleton, cx } from '@/ui/kit';
import { useConfirm, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { useAssignees } from '@/features/followups/shared';
import { useShifts } from '@/features/volunteers/queries';
import { slotsFor, type Shift } from '@/features/volunteers/model';
import {
  Progress, TickBox, DayShort, byDue, fmtHours, fmtTotal, isOverdue, sumHours, useEventTasks, usePrepTemplates, useTickMany, useToggleTask,
} from './shared';
import { Dot, TaskLine } from './TaskLine';
import { TaskDialog } from './TaskDialog';
import { PaymentsPanel } from './Payments';

type Stage = 'before' | 'on' | 'after';
/**
 * Tasks the system can see were done (the speaker is set, registration is open…): a "נראה שבוצע" hint with a one-tap
 * tick. Matched by the template's wording; the tick itself stays a person's decision.
 */
function seemsDone(t: EventTask, e: EventWithStats, shifts: Shift[] | undefined): string | null {
  const title = t.title.trim();
  if (/^סגירת (מרצה|מנחה)/.test(title)) {
    return (e.speaker_id || e.instructor_id) && (e.lecture_topic || e.activity_name) ? 'המרצה והנושא כבר בפרטי המפגש' : null;
  }
  if (/^אישור (מאמן|מדריך)/.test(title)) return e.instructor_id ? 'המדריך כבר בפרטי המפגש' : null;
  if (/^פתיחת (המפגש|האירוע) במערכת/.test(title)) return e.status === 'open' || e.status === 'closed' ? 'ההרשמה למפגש כבר פתוחה' : null;
  if (/^גיוס/.test(title) && /מתנדב/.test(title) && shifts) {
    const slots = slotsFor(e, shifts);
    const entrance = slots.find((x) => x.def.role === 'entrance');
    if (/קבלת פנים/.test(title)) return entrance && entrance.filled > 0 ? 'כבר יש שיבוץ לקבלת פנים' : null;
    return slots.length && slots.every((x) => x.missing === 0) ? 'כל המקומות למתנדבים משובצים' : null;
  }
  return null;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: 'before', label: 'לפני המפגש' },
  { key: 'on', label: 'ביום המפגש' },
  { key: 'after', label: 'אחרי המפגש' },
];

/** The meeting's "הכנות" tab: the checklist by stage, the equipment to pack, and what is owed to whom. */
export function EventPrepTab({ event }: { event: EventWithStats }) {
  const q = useEventTasks(event.id);
  const templates = usePrepTemplates();
  const qc = useQueryClient();
  const toast = useToast();
  const { name: staffName } = useAssignees();
  const shifts = useShifts(event.id);
  const speakers = useSpeakers();
  const toggle = useToggleTask();
  const tickMany = useTickMany();
  const [editing, setEditing] = useState<EventTask | 'new' | null>(null);
  const day = ilParts(event.starts_at).date;
  const today = todayIl();
  const live = event.status !== 'cancelled';

  const all = useMemo(() => q.data ?? [], [q.data]);
  const tasks = useMemo(() => all.filter((t) => t.kind === 'task' && !t.dismissed).sort(byDue), [all]);
  const equipment = useMemo(() => all.filter((t) => t.kind === 'equipment' && !t.dismissed).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'he')), [all]);
  const missing = useMemo(() => {
    if (!templates.data || !q.data) return 0;
    const have = new Set(all.map((t) => t.template_id));
    return templates.data.filter((t) => t.is_active && (t.event_type === event.type || t.event_type === 'all') && !have.has(t.id)).length;
  }, [templates.data, q.data, all, event.type]);

  const init = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('staff_prep_init', { p_event_id: event.id });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['event_tasks'] });
      toast.success(n ? `נוספו ${n} פריטים מהתבנית` : 'הרשימה כבר מעודכנת לפי התבנית');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isError) return <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Panel><Skeleton lines={8} /></Panel>;

  if (!all.length) {
    return (
      <Panel>
        {live ? (
          <EmptyState icon="task" title="למפגש הזה עוד אין רשימת הכנות" action={<Button cta busy={init.isPending} onClick={() => init.mutate()}>יצירת רשימת ההכנות מהתבנית</Button>}>
            המפגש נוצר לפני שהיו הכנות במערכת. הרשימה נבנית מהתבנית של {event.type === 'friday' ? 'מפגשי שישי' : event.type === 'bonfire' ? 'ערבי מדורה' : 'פעילויות אחרות'}, עם תאריך לכל משימה לפי מועד המפגש.
          </EmptyState>
        ) : (
          <EmptyState icon="task" title="המפגש בוטל">למפגש מבוטל אין רשימת הכנות.</EmptyState>
        )}
      </Panel>
    );
  }

  const done = tasks.filter((t) => t.done_at).length;
  const open = tasks.filter((t) => !t.done_at);
  // past-due tasks get one question at the top instead of a red badge each (a new meeting starts with several)
  const late = live ? open.filter((t) => isOverdue(t, today)) : [];
  const next = open.find((t) => !isOverdue(t, today)) ?? open[0];
  const people = [
    ...(event.speaker_id ? [{ id: event.speaker_id, what: 'הרצאה' }] : []),
    ...(event.instructor_id ? [{ id: event.instructor_id, what: 'הדרכה' }] : []),
  ].flatMap(({ id, what }) => {
    const p = speakers.data?.find((x) => x.id === id);
    return p ? [{ name: p.full_name, what }] : [];
  });
  const stageOf = (t: EventTask): Stage => (!t.due_date || t.due_date < day ? 'before' : t.due_date === day ? 'on' : 'after');
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const packed = equipment.filter((t) => t.done_at).length;

  return (
    <div className="flex flex-col gap-5">
      {/* readiness at a glance */}
      <section aria-label="מצב ההכנות" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-edge sm:grid-cols-[minmax(12rem,1fr)_auto_2fr]">
        <div className="bg-paper px-4 py-3">
          <p className="text-micro font-medium text-muted">מוכנות</p>
          <p className="mt-0.5 flex items-baseline gap-1.5"><span className="num font-display text-stat">{done}</span><span className="text-small text-muted">מתוך <span className="num">{tasks.length}</span> משימות</span></p>
          <Progress value={tasks.length ? done / tasks.length : 0} label="מוכנות המפגש" className="mt-2" />
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-micro font-medium text-muted">שעות עבודה שנותרו</p>
          <p className="num mt-0.5 font-display text-stat">{fmtTotal(sumHours(open))}</p>
        </div>
        <div className="col-span-2 bg-paper px-4 py-3 sm:col-span-1">
          <p className="text-micro font-medium text-muted">המשימה הבאה</p>
          {next ? (
            <>
              <p className="mt-1 font-semibold leading-snug">{next.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-muted">
                {next.due_date && <DayShort day={next.due_date} time={next.due_time} />}
              </p>
            </>
          ) : <p className="mt-1 flex items-center gap-1.5 font-semibold"><Icon name="checkCircle" size={18} />הכול מוכן</p>}
        </div>
      </section>

      {late.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-control)] border-s-[3px] border-warn bg-warn-wash px-4 py-3">
          <Icon name="alert" size={18} className="shrink-0 self-start text-warn sm:self-center" />
          <div className="min-w-0 flex-1 basis-60">
            <p className="font-semibold text-warn">
              {late.length === 1 ? 'משימה אחת הייתה אמורה להיעשות כבר. לסמן שבוצעה?' : <><span className="num">{late.length}</span> משימות היו אמורות להיעשות כבר. לסמן שבוצעו?</>}
            </p>
            <p className="text-small text-ink-soft">אפשר גם לסמן אחת־אחת ברשימה. מה שלא מסומן נשאר ב"השבוע שלי".</p>
          </div>
          <Button size="sm" variant="secondary" icon="check" busy={tickMany.isPending} onClick={() => tickMany.mutate(late.map((t) => t.id))}>
            {late.length === 1 ? 'סימון כבוצעה' : <>סימון <span className="num">{late.length}</span> כבוצעו</>}
          </Button>
        </div>
      )}

      <nav aria-label="קפיצה בתוך ההכנות" className="-mt-1 flex flex-wrap gap-2 lg:hidden">
        <Button size="sm" variant="secondary" onClick={() => jump('equipment')}>ציוד <span className="num text-muted">{packed}/{equipment.length}</span></Button>
        <Button size="sm" variant="secondary" onClick={() => jump('payments')}>תשלומים לספקים</Button>
      </nav>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="משימות"
          actions={<Button size="sm" variant="secondary" icon="plus" onClick={() => setEditing('new')}>הוספת משימה</Button>}
          padded={false}
        >
          {STAGES.map(({ key, label }) => {
            const list = tasks.filter((t) => stageOf(t) === key);
            if (!list.length) return null;
            const left = list.filter((t) => !t.done_at);
            return (
              <section key={key} aria-label={label} className="border-b border-edge px-4 pt-3 pb-2 last:border-b-0 sm:px-5">
                <h3 className="flex items-baseline justify-between gap-2">
                  <span className="text-small font-bold text-ink">{label}</span>
                  <span className="num text-micro text-muted">
                    {list.length - left.length}/{list.length}{sumHours(left) > 0 && <> · נותרו {fmtTotal(sumHours(left))} ש׳</>}
                  </span>
                </h3>
                <ul className="mt-1">
                  {list.map((t) => {
                    const why = live ? seemsDone(t, event, shifts.data) : null;
                    return (
                      <TaskLine
                        key={t.id}
                        task={t}
                        onEdit={() => setEditing(t)}
                        meta={<>
                          {t.due_date ? <DayShort day={t.due_date} time={t.due_time} className={cx(isOverdue(t, today) && 'font-semibold text-warn')} /> : <span>בלי תאריך</span>}
                          {t.hours ? <><Dot /><span>{fmtHours(t.hours)}</span></> : null}
                          {t.assignee_id && <><Dot /><span>{staffName.get(t.assignee_id) ?? 'צוות'}</span></>}
                        </>}
                        hint={why && (
                          <button
                            type="button"
                            onClick={() => toggle.mutate({ id: t.id, done: true })}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-ink/30 bg-paper px-2.5 text-small text-ink hover:border-ink pointer-coarse:min-h-11"
                          >
                            <Icon name="checkCircle" size={15} className="shrink-0" />
                            <span>נראה שבוצע: {why}.</span>
                            <span className="font-semibold text-tide underline underline-offset-2">סימון</span>
                          </button>
                        )}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {missing > 0 && live && event.status !== 'completed' && (
            <p className="flex flex-wrap items-center gap-x-2 border-t border-edge px-4 py-2 text-small text-muted sm:px-5">
              בתבנית יש עוד <span className="num">{missing}</span> {missing === 1 ? 'פריט שאינו' : 'פריטים שאינם'} ברשימה של המפגש הזה (נוספו לתבנית אחרי שהמפגש נוצר).
              <button type="button" disabled={init.isPending} onClick={() => init.mutate()} className="inline-flex min-h-11 items-center font-semibold text-tide hover:underline">הוספה מהתבנית</button>
            </p>
          )}
        </Panel>

        <EquipmentPanel eventId={event.id} items={equipment} />
      </div>

      <PaymentsPanel eventId={event.id} people={people} />

      {editing && <TaskDialog task={editing === 'new' ? null : editing} eventId={event.id} meetingDay={day} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ───────────── equipment: the small things that get forgotten ─────────────

function EquipmentPanel({ eventId, items }: { eventId: string; items: EventTask[] }) {
  const toggle = useToggleTask();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [editMode, setEditMode] = useState(false);
  const packed = items.filter((t) => t.done_at).length;

  const add = useMutation({
    mutationFn: async (t: string) => {
      const { error } = await supabase.from('event_tasks').insert({ event_id: eventId, kind: 'equipment', category: 'equipment', title: t, sort_order: 900 });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      qc.invalidateQueries({ queryKey: ['event_tasks'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['event_tasks'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (t.length < 2) return;
    add.mutate(t.slice(0, 120));
  };

  return (
    <Panel
      id="equipment"
      title="ציוד"
      description={items.length ? <><span className="num">{packed}</span> מתוך <span className="num">{items.length}</span> ארוזים</> : 'מה לוקחים למפגש'}
      actions={items.length > 0 && (
        <Button size="sm" variant="ghost" icon={editMode ? 'check' : 'edit'} aria-pressed={editMode} onClick={() => setEditMode((v) => !v)}>{editMode ? 'סיום' : 'עריכה'}</Button>
      )}
      className="scroll-mt-4"
    >
      {items.length > 0 && <Progress value={packed / items.length} label="ציוד ארוז" className="mb-3" />}
      {items.length === packed && items.length > 0 && (
        <p className="mb-3 flex items-center gap-1.5 text-small font-semibold"><Icon name="checkCircle" size={17} />הכול ארוז</p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" aria-label="רשימת ציוד">
        {items.map((t) => {
          const on = !!t.done_at;
          return (
            <li key={t.id} className={cx('flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border ps-2 pe-1 transition-colors', on ? 'border-edge bg-mist/50' : 'border-control-line bg-paper')}>
              <TickBox checked={on} onChange={(v) => toggle.mutate({ id: t.id, done: v })} label={`ארוז: ${t.title}`} />
              <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => toggle.mutate({ id: t.id, done: !on })}
                className={cx('min-h-11 flex-1 py-2 text-start leading-snug', on ? 'text-muted line-through decoration-ink/35' : 'font-medium')}>
                {t.title}
              </button>
              {editMode && (
                <IconButton icon="close" label={`הסרה מהמפגש: ${t.title}`} onClick={async () => {
                  if (await confirm({ title: 'הסרת פריט', body: <>להסיר את "{t.title}" מרשימת הציוד של המפגש הזה? התבנית לא משתנה.</>, confirm: 'הסרה', danger: true })) remove.mutate(t.id);
                }} />
              )}
            </li>
          );
        })}
      </ul>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="equipment-new">פריט ציוד נוסף למפגש הזה</label>
        <input
          id="equipment-new"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="עוד משהו לקחת? למשל: מטען לרמקול"
          className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-control-line bg-paper px-3 text-ink placeholder:text-faint hover:border-ink focus:border-ink focus:ring-2 focus:ring-ink focus:outline-none"
        />
        <Button type="submit" variant="secondary" icon="plus" busy={add.isPending} disabled={title.trim().length < 2}>הוספה</Button>
      </form>
      <p className="mt-1.5 text-micro text-muted">פריט שמוסיפים כאן נשאר רק במפגש הזה. את הרשימה הקבועה עורכים במסך ההכנות, בלשונית "תבנית".</p>
    </Panel>
  );
}
