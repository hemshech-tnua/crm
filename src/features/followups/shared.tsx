// Follow-up building blocks used by the work queue (FollowUpsPage) and by the participant card.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useMe } from '@/lib/auth';
import { useStaffList } from '@/lib/data';
import { addDays, todayIl } from '@/lib/dates';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { CHANNEL_LABEL } from '@/lib/labels';
import type { FollowUp } from '@/lib/types';
import { Button, Checkbox, ChoiceGroup, Input, Select, Textarea } from '@/ui/kit';
import { Dialog, useConfirm, useToast } from '@/ui/feedback';
import { MessageComposer } from '@/ui/MessageComposer';
import {
  EVENT_FOR_MESSAGE, FieldGuidance, ParticipantPicker, eventContext, type EventForMessage, type PickedParticipant,
} from '@/features/participants/shared';

export type Channel = keyof typeof CHANNEL_LABEL;

export type TaskParticipant = { id: string; full_name: string | null; phone: string | null; consent_updates: boolean };
export type TaskRow = FollowUp & {
  completed_by: string | null;
  participant: TaskParticipant | null;
  event: EventForMessage | null;
};
export const TASK_SELECT = `*, participant:participants(id,full_name,phone,consent_updates), event:events(${EVENT_FOR_MESSAGE})`;

export const LAPSED_TASK_TITLE = 'קבוע/ה שהפסיק/ה להגיע: לשאול מה שלומו/ה';

/** After any change to tasks: the queue, the dashboard's "needs attention", and the person's card. */
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return (participantId?: string | null) => {
    qc.invalidateQueries({ queryKey: ['followups'] });
    qc.invalidateQueries({ queryKey: ['attention'] });
    if (participantId) {
      qc.invalidateQueries({ queryKey: ['participant', participantId] });
      qc.invalidateQueries({ queryKey: ['contact_log', participantId] });
    }
  };
}

/** Staff who can own a task (active admins and coordinators). */
export function useAssignees() {
  const staff = useStaffList();
  return useMemo(() => {
    const all = staff.data ?? [];
    return {
      list: all.filter((s) => s.is_active && s.role !== 'volunteer'),
      name: new Map(all.map((s) => [s.user_id, s.full_name])),
    };
  }, [staff.data]);
}

// ───────────── WhatsApp from a task ─────────────

/** The message that fits the task (questionnaire Q17, Q24): "missed you" after a no-show, "long time" for a lapsed regular… */
export function taskTemplates(type: FollowUp['type']): { keys: string[]; defaultKey: string; ctx: 'task' | 'next' } {
  switch (type) {
    case 'no_show': return { keys: ['missed_you'], defaultKey: 'missed_you', ctx: 'task' };
    case 'first_time': return { keys: ['thanks'], defaultKey: 'thanks', ctx: 'task' };
    case 'waitlist': return { keys: ['waitlist_promoted'], defaultKey: 'waitlist_promoted', ctx: 'task' };
    case 'lapsed': return { keys: ['lapsed', 'invite_next'], defaultKey: 'lapsed', ctx: 'next' };
    // they asked to be contacted, so the reply is a service message (no consent needed)
    case 'membership': return { keys: ['membership_reply'], defaultKey: 'membership_reply', ctx: 'next' };
    default: return { keys: ['invite_next', 'lapsed'], defaultKey: 'invite_next', ctx: 'next' };
  }
}

export function TaskComposer({ task, nextEvent, onClose }: { task: TaskRow; nextEvent: EventForMessage | null | undefined; onClose: () => void }) {
  const t = taskTemplates(task.type);
  const ev = t.ctx === 'task' ? task.event ?? nextEvent : nextEvent;
  if (!task.participant) return null;
  return (
    <MessageComposer
      open
      onClose={onClose}
      recipient={task.participant}
      context={eventContext(ev)}
      templateKeys={t.keys}
      defaultKey={t.defaultKey}
      eventId={task.event_id}
      followUpId={task.id}
    />
  );
}

// ───────────── complete a task ─────────────

const QUICK_OUTCOMES = ['הכול בסדר, יגיע/תגיע בשישי הבא', 'עסוק/ה בתקופה הזו, נחזור בעוד חודש', 'ביקש/ה לא לפנות שוב'];

export function CompleteTaskDialog({ task, onClose }: {
  task: Pick<FollowUp, 'id' | 'participant_id' | 'event_id' | 'title'> & { participantName?: string | null };
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [outcome, setOutcome] = useState('');
  const [channel, setChannel] = useState<Channel>('phone');
  const [err, setErr] = useState<string | null>(null);
  // S4: other open tasks for the same person (one conversation usually answers all of them)
  const others = useQuery({
    queryKey: ['followups', 'others', task.participant_id, task.id],
    queryFn: async () => must(await supabase.from('follow_ups').select('id, title').eq('participant_id', task.participant_id)
      .eq('status', 'open').neq('id', task.id)) as { id: string; title: string }[],
  });
  const [closeOthers, setCloseOthers] = useState(true);
  // S1: "didn't answer" keeps the task open, logs the attempt and moves the due date
  const retry = useMutation({
    mutationFn: async () => {
      const due = addDays(todayIl(), 2);
      const { error } = await supabase.from('follow_ups').update({ due_date: due }).eq('id', task.id);
      if (error) throw error;
      const { error: logErr } = await supabase.from('contact_log').insert({
        participant_id: task.participant_id, channel, summary: 'ניסיון יצירת קשר: לא ענה/תה', follow_up_id: task.id, event_id: task.event_id,
      });
      if (logErr) throw logErr;
    },
    onSuccess: () => {
      invalidate(task.participant_id);
      toast.success('הניסיון נרשם. המשימה נשארת פתוחה ליומיים הקרובים.');
      onClose();
    },
    onError: (e: unknown) => setErr(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: async () => {
      const text = outcome.trim();
      const { error } = await supabase.from('follow_ups').update({ status: 'done', outcome: text }).eq('id', task.id);
      if (error) throw error;
      if (closeOthers && others.data?.length) {
        const { error: e2 } = await supabase.from('follow_ups').update({ status: 'done', outcome: `נסגר יחד עם "${task.title}": ${text}` })
          .in('id', others.data.map((o) => o.id));
        if (e2) throw e2;
      }
      const { error: logErr } = await supabase.from('contact_log').insert({
        participant_id: task.participant_id, channel, summary: text, follow_up_id: task.id, event_id: task.event_id,
      });
      if (logErr) throw { ...logErr, partial: true };
    },
    onSuccess: () => {
      invalidate(task.participant_id);
      toast.success('המשימה הושלמה ונרשמה בהיסטוריית הקשר');
      onClose();
    },
    onError: (e: unknown) => {
      invalidate(task.participant_id);
      if ((e as { partial?: boolean })?.partial) {
        toast.error('המשימה סומנה כבוצעה, אבל תיעוד השיחה לא נשמר. אפשר לתעד אותה מהכרטיס.');
        onClose();
      } else setErr(errorMessage(e));
    },
  });
  const submit = () => {
    if (outcome.trim().length < 2) return setErr('כותבים במשפט קצר מה עלה בשיחה.');
    setErr(null);
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="סימון כבוצע"
      footer={<>
        <Button icon="check" busy={save.isPending} disabled={retry.isPending} onClick={submit}>בוצע: שמירה</Button>
        <Button variant="secondary" icon="undo" busy={retry.isPending} disabled={save.isPending} onClick={() => retry.mutate()}>לא ענה/תה: לנסות שוב בעוד יומיים</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[0.95rem] text-ink-soft">{task.title}{task.participantName ? ` · ${task.participantName}` : ''}</p>
        <ChoiceGroup<Channel>
          legend="איך דיברתם?"
          columns={2}
          value={channel}
          onChange={setChannel}
          options={(['phone', 'whatsapp', 'in_person', 'other'] as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
        <div className="flex flex-col gap-2">
          <Textarea label="מה עלה בשיחה?" required value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={1000} rows={4} error={err} placeholder="למשל: מרגיש טוב, עבר לעבוד בבוקר בשישי" />
          <div className="flex flex-wrap gap-2">
            {QUICK_OUTCOMES.map((q) => (
              <button key={q} type="button" onClick={() => setOutcome(q)} className="min-h-9 rounded-full border border-line bg-paper px-3 text-sm font-medium text-ink-soft hover:border-tide hover:text-tide">
                {q}
              </button>
            ))}
          </div>
          <FieldGuidance />
        </div>
        {(others.data?.length ?? 0) > 0 && (
          <Checkbox
            checked={closeOthers}
            onChange={setCloseOthers}
            label={`לסגור גם ${others.data!.length === 1 ? 'את המשימה הפתוחה הנוספת' : `את ${others.data!.length} המשימות הפתוחות הנוספות`} של ${task.participantName ?? 'אותו אדם'}`}
            hint={others.data!.map((o) => o.title).join(' · ')}
          />
        )}
      </div>
    </Dialog>
  );
}

// ───────────── reassign / reschedule / cancel ─────────────

export function EditTaskDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateTasks();
  const { list } = useAssignees();
  const [assignee, setAssignee] = useState(task.assignee_id ?? '');
  const [due, setDue] = useState(task.due_date ?? '');
  const [title, setTitle] = useState(task.title);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (patch: Partial<FollowUp>) => {
      const { error } = await supabase.from('follow_ups').update(patch).eq('id', task.id);
      if (error) throw error;
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    if (title.trim().length < 2) return setErr('צריך כותרת למשימה.');
    save.mutate({ assignee_id: assignee || null, due_date: due || null, title: title.trim() }, {
      onSuccess: () => { invalidate(task.participant_id); toast.success('המשימה עודכנה'); onClose(); },
    });
  };
  const cancelTask = async () => {
    const ok = await confirm({
      title: 'לבטל את המשימה?',
      body: 'המשימה תעבור ל"הושלמו" עם הסטטוס "בוטלה". שום הודעה לא נשלחת ללוחם/ת.',
      confirm: 'ביטול המשימה',
      cancel: 'חזרה',
      danger: true,
    });
    if (!ok) return;
    save.mutate({ status: 'cancelled' }, {
      onSuccess: () => { invalidate(task.participant_id); toast.success('המשימה בוטלה'); onClose(); },
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="עריכת משימה"
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>סגירה</Button>
        <Button variant="danger" className="ms-auto" onClick={cancelTask}>ביטול המשימה</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <Input label="כותרת" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        <Select label="אחראי/ת" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">ללא אחראי/ת</option>
          {list.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
        </Select>
        <Input label="תאריך יעד" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        {err && <p className="text-sm font-medium text-bad" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}

// ───────────── new task ─────────────

export function NewTaskDialog({ participant, onClose, onCreated }: {
  participant?: { id: string; full_name: string | null } | null;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const toast = useToast();
  const me = useMe();
  const invalidate = useInvalidateTasks();
  const { list } = useAssignees();
  const [person, setPerson] = useState<PickedParticipant | { id: string; full_name: string | null } | null>(participant ?? null);
  const [title, setTitle] = useState('שיחת מעקב');
  const [due, setDue] = useState(addDays(todayIl(), 3));
  const [assignee, setAssignee] = useState(me.data?.user_id ?? '');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('follow_ups').insert({
        participant_id: person!.id, type: 'general', title: title.trim(), due_date: due || null,
        assignee_id: assignee || null, notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate(person!.id);
      toast.success('המשימה נפתחה');
      onCreated?.();
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    if (!person) return setErr('בוחרים לוחם/ת.');
    if (title.trim().length < 2) return setErr('צריך כותרת למשימה.');
    setErr(null);
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="משימה חדשה"
      footer={<>
        <Button icon="plus" busy={save.isPending} onClick={submit}>פתיחת המשימה</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        {person ? (
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-tide-wash px-3.5 py-2.5">
            <span><span className="text-sm text-muted">לוחם/ת: </span><span className="font-semibold">{person.full_name}</span></span>
            {!participant && <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>החלפה</Button>}
          </div>
        ) : (
          <ParticipantPicker onPick={setPerson} label="עם מי צריך לדבר?" />
        )}
        <Input label="מה צריך לעשות?" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="תאריך יעד" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Select label="אחראי/ת" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">ללא אחראי/ת</option>
            {list.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Textarea label="הערה (לא חובה)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
          <FieldGuidance />
        </div>
        {err && <p className="text-sm font-medium text-bad" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}

/** Opens a "lapsed regular" task: the approval step before anyone sends that person a message (Q37). */
export function useOpenLapsedTask() {
  const toast = useToast();
  const me = useMe();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (participantId: string) => {
      const { error } = await supabase.from('follow_ups').insert({
        participant_id: participantId, type: 'lapsed', title: LAPSED_TASK_TITLE,
        due_date: addDays(todayIl(), 3), assignee_id: me.data?.user_id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, id) => { invalidate(id); toast.success('נפתחה משימה. היא מופיעה עכשיו ב"שלי".'); },
    onError: (e, id) => {
      invalidate(id);
      toast.error(errorCode(e) === 'duplicate_phone' ? 'כבר יש משימה פתוחה ללוחם/ת הזה/ו.' : errorMessage(e));
    },
  });
}
