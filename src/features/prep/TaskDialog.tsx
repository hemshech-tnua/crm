import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import type { EventTask } from '@/lib/types';
import { Button, Input, Select, Textarea } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { useAssignees } from '@/features/followups/shared';
import { dayShort, hhmm } from './shared';

/** Edit one task of a meeting, or add a one-off task to it (task = null). */
export function TaskDialog({ task, eventId, meetingDay, onClose }: { task: EventTask | null; eventId: string; meetingDay: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { list: staff } = useAssignees();
  const [f, setF] = useState({
    title: task?.title ?? '',
    due_date: task?.due_date ?? '',
    due_time: hhmm(task?.due_time),
    hours: task?.hours != null ? String(Number(task.hours)) : '',
    assignee_id: task?.assignee_id ?? '',
    notes: task?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const done = () => {
    qc.invalidateQueries({ queryKey: ['event_tasks'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        title: f.title.trim(),
        due_date: f.due_date || null,
        due_time: f.due_time || null,
        hours: f.hours.trim() ? Number(f.hours) : null,
        assignee_id: f.assignee_id || null,
        notes: f.notes.trim() || null,
      };
      if (task) {
        // a date set by hand stays put when the meeting moves (Itai's "manual date")
        const moved = (task.due_date ?? '') !== f.due_date;
        const { error } = await supabase.from('event_tasks').update({ ...row, ...(moved ? { due_manual: true } : {}) }).eq('id', task.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('event_tasks').insert({ ...row, event_id: eventId, kind: 'task', category: 'general', sort_order: 500, due_manual: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(task ? 'המשימה נשמרה' : 'המשימה נוספה');
      done();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('event_tasks').delete().eq('id', task!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('המשימה נמחקה');
      done();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const h = f.hours.trim() ? Number(f.hours) : null;
    const next = {
      title: f.title.trim().length < 2 ? 'צריך לכתוב מה המשימה.' : f.title.trim().length > 120 ? 'עד 120 תווים.' : null,
      hours: h != null && (Number.isNaN(h) || h < 0 || h > 24) ? 'מספר שעות בין 0 ל-24 (למשל 0.5).' : null,
      notes: f.notes.length > 500 ? 'עד 500 תווים.' : null,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    save.mutate();
  };

  const del = async () => {
    if (await confirm({ title: 'מחיקת המשימה', body: <>למחוק את "{task!.title}" מהמפגש הזה? התבנית לא משתנה.</>, confirm: 'מחיקה', danger: true })) remove.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? 'עריכת משימה' : 'משימה חדשה למפגש'}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>{task ? 'שמירה' : 'הוספה'}</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
        {task && <Button variant="danger" icon="close" className="ms-auto" busy={remove.isPending} onClick={del}>מחיקה</Button>}
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="מה צריך לעשות" required value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} maxLength={120} autoFocus={!task} />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="עד מתי"
            type="date"
            value={f.due_date}
            onChange={(e) => set('due_date', e.target.value)}
            hint={f.due_date ? (task && task.due_date !== f.due_date ? 'תאריך ידני: לא יזוז אם המפגש יזוז' : dayShort(f.due_date)) : `המפגש: ${dayShort(meetingDay)}`}
          />
          <Input label="שעה קבועה" type="time" value={f.due_time} onChange={(e) => set('due_time', e.target.value)} hint="לא חובה" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="הערכת זמן (שעות)" inputMode="decimal" type="number" min={0} max={24} step={0.25} value={f.hours} onChange={(e) => set('hours', e.target.value)} error={errors.hours} hint="0.25 = רבע שעה" />
          <Select label="באחריות" value={f.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
            <option value="">הרכז/ת</option>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
          </Select>
        </div>
        <Textarea label="הערות" value={f.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} maxLength={500} rows={3} />
        {task?.due_manual && task.template_id && <p className="text-small text-muted">למשימה נקבע תאריך ידני, ולכן היא לא זזה כשהמפגש זז.</p>}
        {formError && <p className="text-small font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
