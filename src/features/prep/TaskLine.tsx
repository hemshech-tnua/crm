import type { ReactNode } from 'react';
import type { EventTask } from '@/lib/types';
import { IconButton, cx } from '@/ui/kit';
import { TickBox, useToggleTask } from './shared';

/** One task: the big tick, the title, a line of facts (date, hour, hours, meeting…), the notes and an optional hint. */
export function TaskLine({ task, meta, hint, onEdit, compact, className = '' }: {
  task: Pick<EventTask, 'id' | 'title' | 'done_at' | 'notes'>; meta?: ReactNode; /** e.g. "נראה שבוצע" */ hint?: ReactNode; onEdit?: () => void; /** without the notes (the dashboard) */ compact?: boolean; className?: string;
}) {
  const toggle = useToggleTask();
  const done = !!task.done_at;
  return (
    <li className={cx('flex items-start gap-3 py-2', className)}>
      <TickBox checked={done} onChange={(v) => toggle.mutate({ id: task.id, done: v })} label={task.title} />
      <div className="min-w-0 flex-1 pt-1">
        <p className={cx('leading-snug', done ? 'text-muted line-through decoration-ink/35' : 'font-medium text-ink')}>{task.title}</p>
        {meta && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">{meta}</div>}
        {task.notes && !done && !compact && <p className="mt-0.5 text-small whitespace-pre-line text-ink-soft">{task.notes}</p>}
        {hint && !done && <div className="mt-1">{hint}</div>}
      </div>
      {onEdit && <IconButton icon="edit" label={`עריכה: ${task.title}`} onClick={onEdit} className="-my-0.5" />}
    </li>
  );
}

/** The dot between facts in a meta line. */
export const Dot = () => <span aria-hidden="true" className="text-faint">·</span>;
