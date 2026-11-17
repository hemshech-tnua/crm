// Shared pieces of the preparation screens: queries, the one-tap tick, and Itai's way of saying dates.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { addDays, todayIl } from '@/lib/dates';
import { errorMessage, must } from '@/lib/errors';
import type { EventRow, EventTask, EventType, PrepCategory, PrepTemplate, Supplier } from '@/lib/types';
import { useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { cx } from '@/ui/kit';

export const TASK_COLS = 'id,event_id,template_id,kind,category,title,due_date,due_time,due_manual,hours,assignee_id,notes,sort_order,done_at,done_by,dismissed,created_at';
export type TaskEvent = Pick<EventRow, 'id' | 'title' | 'starts_at' | 'type' | 'status'>;
export type TaskWithEvent = EventTask & { event: TaskEvent };
const WITH_EVENT = `${TASK_COLS},event:events!inner(id,title,starts_at,type,status)`;

// ───────────── labels ─────────────

export const CATEGORY_LABEL: Record<PrepCategory, string> = {
  venue: 'מקום', program: 'תוכן', food: 'אוכל', equipment: 'ציוד', marketing: 'פרסום', registrations: 'הרשמה',
  volunteers: 'מתנדבים', payments: 'תשלומים', setup: 'הקמה', after: 'אחרי המפגש', general: 'כללי',
};
export const PREP_TYPE_LABEL: Record<EventType | 'all', string> = { friday: 'שישי', bonfire: 'מדורה', other: 'אחר', all: 'לכל סוגי המפגשים' };
export const WEEKDAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const WEEKDAY_NAME = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WEEK_LABEL: Record<number, string> = { [-3]: 'שלושה שבועות לפני', [-2]: 'שבועיים לפני', [-1]: 'שבוע לפני', 0: 'שבוע המפגש', 1: 'שבוע אחרי', 2: 'שבועיים אחרי' };
export const weekLabel = (w: number) => WEEK_LABEL[w] ?? (w < 0 ? `${-w} שבועות לפני` : `${w} שבועות אחרי`);

/** "שבועיים לפני, ג׳" or "ביום המפגש" / "יומיים אחרי המפגש": the template's "when", in Itai's words. */
export function whenText(t: Pick<PrepTemplate, 'week_offset' | 'weekday' | 'day_offset'>): string {
  if (t.weekday != null) return `${weekLabel(t.week_offset)}, ${WEEKDAY_LETTER[t.weekday]}`;
  const n = t.day_offset;
  if (n === 0) return 'ביום המפגש';
  const days = Math.abs(n) === 1 ? 'יום' : Math.abs(n) === 2 ? 'יומיים' : `${Math.abs(n)} ימים`;
  return `${days} ${n > 0 ? 'אחרי' : 'לפני'} המפגש`;
}

// ───────────── dates (calendar days as "YYYY-MM-DD", already Israel dates) ─────────────

export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const weekStart = (day: string) => addDays(day, -weekdayOf(day));
/** "17.11" */
export const dm = (day: string) => `${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}`;
/** "ג׳ 17.11" */
export const dayShort = (day: string) => `${WEEKDAY_LETTER[weekdayOf(day)]} ${dm(day)}`;
/** "ג׳ 17.11 · 08:15" for the screen: the letter reads first (right), the numbers stay left-to-right. */
export function DayShort({ day, time, className = '' }: { day: string; time?: string | null; className?: string }) {
  return (
    <span className={cx('whitespace-nowrap', className)}>
      {WEEKDAY_LETTER[weekdayOf(day)]} <span className="num">{dm(day)}</span>
      {time ? <> · <span className="num">{hhmm(time)}</span></> : null}
    </span>
  );
}
/** "08:15:00" → "08:15" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 864e5);

/** 0.25 → "15 דק׳", 1.5 → "1.5 ש׳" */
export function fmtHours(h: number | string | null | undefined): string {
  if (h == null || h === '') return '';
  const v = Number(h);
  if (!v) return '';
  if (v < 1) return `${Math.round(v * 60)} דק׳`;
  return `${v.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ש׳`;
}
/** A total: "9.5" (always hours, one decimal at most). */
export const sumHours = (list: { hours: number | null }[]) => list.reduce((s, t) => s + (Number(t.hours) || 0), 0);
export const fmtTotal = (h: number) => h.toLocaleString('he-IL', { maximumFractionDigits: 1 });

// one money format for the whole app (lib/money); re-exported for the prep screens
export { fmtMoney } from '@/lib/money';

export const isOverdue = (t: Pick<EventTask, 'done_at' | 'due_date'>, today = todayIl()) => !t.done_at && !!t.due_date && t.due_date < today;

export const byDue = (a: EventTask, b: EventTask) =>
  (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (hhmm(a.due_time) || '99').localeCompare(hhmm(b.due_time) || '99') || a.sort_order - b.sort_order;

// ───────────── queries ─────────────
// Every list of tasks lives under ['event_tasks', …], so a tick can update them all at once.

export const useEventTasks = (eventId: string) =>
  useQuery({
    queryKey: ['event_tasks', 'event', eventId],
    queryFn: async () => must(await supabase.from('event_tasks').select(TASK_COLS).eq('event_id', eventId).order('sort_order')) as EventTask[],
  });

/** Tasks due in [from, to] across all meetings that are not cancelled (equipment is packed with its task). */
export const useTasksBetween = (from: string, to: string) =>
  useQuery({
    queryKey: ['event_tasks', 'range', from, to],
    queryFn: async () => must(await supabase.from('event_tasks').select(WITH_EVENT).eq('kind', 'task').eq('dismissed', false)
      .gte('due_date', from).lte('due_date', to).neq('event.status', 'cancelled')
      .order('due_date').order('sort_order').limit(500)) as unknown as TaskWithEvent[],
  });

/** How far back "left open from before" looks: older loose ends belong to meetings long gone. */
export const OVERDUE_DAYS = 60;
export const useOverdueTasks = () => {
  const today = todayIl();
  return useQuery({
    queryKey: ['event_tasks', 'overdue', today],
    queryFn: async () => must(await supabase.from('event_tasks').select(WITH_EVENT).eq('kind', 'task').eq('dismissed', false).is('done_at', null)
      .lt('due_date', today).gte('due_date', addDays(today, -OVERDUE_DAYS)).neq('event.status', 'cancelled')
      .order('due_date').order('sort_order').limit(200)) as unknown as TaskWithEvent[],
  });
};

export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => must(await supabase.from('suppliers').select('id,name,what,contact_name,phone,cost_note,notes,is_active').order('name')) as Supplier[],
  });

export const usePrepTemplates = () =>
  useQuery({
    queryKey: ['prep_templates'],
    queryFn: async () => must(await supabase.from('prep_templates')
      .select('id,event_type,kind,category,title,week_offset,weekday,day_offset,fixed_time,hours,notes,sort_order,is_active')
      .order('sort_order').order('title')) as PrepTemplate[],
  });

/** Tick or untick a task (or an equipment item), at once on every list that shows it; the server stamps the time. */
export function useToggleTask() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationKey: ['toggle-task'],
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase.from('event_tasks').update({ done_at: done ? new Date().toISOString() : null }).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: ['event_tasks'] });
      const snapshot = qc.getQueriesData<EventTask[]>({ queryKey: ['event_tasks'] });
      const doneAt = done ? new Date().toISOString() : null;
      qc.setQueriesData<EventTask[]>({ queryKey: ['event_tasks'] }, (old) => (Array.isArray(old) ? old.map((t) => (t.id === id ? { ...t, done_at: doneAt } : t)) : old));
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      // refetch only after the last of several quick ticks, so a slower answer does not flip a box back
      if (qc.isMutating({ mutationKey: ['toggle-task'] }) <= 1) qc.invalidateQueries({ queryKey: ['event_tasks'] });
    },
  });
}

// ───────────── the tick ─────────────

/** A big square checkbox (44px target) for one-tap ticking. */
export function TickBox({ checked, onChange, label, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label: string; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="group -m-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-ink"
    >
      <span className={cx(
        'flex items-center justify-center rounded-[3px] border-2 transition-colors',
        size === 'lg' ? 'h-8 w-8' : 'h-7 w-7',
        checked ? 'border-ink bg-ink text-light' : 'border-control-line bg-paper text-transparent group-hover:border-ink',
      )}>
        <Icon name="check" size={size === 'lg' ? 20 : 18} strokeWidth={3} />
      </span>
    </button>
  );
}

/** A thin progress bar (done / total), squared like the rest of the brand. */
export function Progress({ value, label, className = '' }: { value: number; label: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={cx('h-2 w-full overflow-hidden rounded-[2px] bg-ink/10', className)}>
      <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}
