// Volunteer data: the pool, the meetings ahead and the shifts, read and written directly under RLS (admin, coordinator).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage, must } from '@/lib/errors';
import type { ShiftStatus, Volunteer, VolunteerRole } from '@/lib/types';
import { useToast } from '@/ui/feedback';
import { PLAN_DAYS, STATUS_LABEL, type PlanEvent, type Shift } from './model';

/** link_token_hash is not selectable: always these columns, never `*`. */
export const VOLUNTEER_COLUMNS = 'id, full_name, phone, roles, notes, is_active, created_at';
const EVENT_COLUMNS = 'id, title, type, starts_at, ends_at, location, status';
const SHIFT_COLUMNS = `id, event_id, volunteer_id, role, status, responded_at, notes, event:events!inner(${EVENT_COLUMNS})`;

export const useVolunteers = () =>
  useQuery({
    queryKey: ['volunteers'],
    queryFn: async () => must(await supabase.from('volunteers').select(VOLUNTEER_COLUMNS).order('full_name')) as Volunteer[],
  });

/** The meetings of the next ~3 months that still happen (drafts included: they are the ones booked ahead). */
export const usePlanEvents = () =>
  useQuery({
    queryKey: ['events', 'volunteer_plan'],
    queryFn: async () => {
      const now = new Date();
      const to = new Date(now.getTime() + PLAN_DAYS * 864e5);
      return must(await supabase.from('events').select(EVENT_COLUMNS)
        .gt('ends_at', now.toISOString()).lt('starts_at', to.toISOString())
        .not('status', 'in', '(cancelled,completed)').order('starts_at')) as PlanEvent[];
    },
  });

/**
 * Shifts (not cancelled) with their meeting: of one meeting, or of every meeting from a year back (enough for the
 * planner, the pool's counts and a volunteer's message).
 */
export const useShifts = (eventId?: string) =>
  useQuery({
    queryKey: ['volunteer_shifts', eventId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('volunteer_shifts').select(SHIFT_COLUMNS).neq('status', 'cancelled');
      q = eventId ? q.eq('event_id', eventId) : q.gte('event.ends_at', new Date(Date.now() - 365 * 864e5).toISOString());
      return must(await q.limit(5000)) as unknown as Shift[];
    },
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['volunteer_shifts'] });
    void qc.invalidateQueries({ queryKey: ['volunteers'] });
  };
}

/**
 * Invite a volunteer to a role at one or more meetings (status 'invited'). A row that already exists for the same
 * person, meeting and role (cancelled or declined before) is reopened. `replace` cancels the shift being replaced.
 */
export function useAssign() {
  const invalidate = useInvalidate();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { volunteerId: string; role: VolunteerRole; eventIds: string[]; replace?: string | null; done: string }) => {
      const rows = v.eventIds.map((event_id) => ({ event_id, volunteer_id: v.volunteerId, role: v.role, status: 'invited', responded_at: null }));
      const { error } = await supabase.from('volunteer_shifts').upsert(rows, { onConflict: 'event_id,volunteer_id,role' });
      if (error) throw error;
      if (v.replace) {
        const { error: e2 } = await supabase.from('volunteer_shifts').update({ status: 'cancelled' }).eq('id', v.replace);
        if (e2) throw e2;
      }
    },
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.done);
    },
    onError: (e) => {
      invalidate();
      toast.error(errorMessage(e));
    },
  });
}

/** Mark by hand (answered on the phone), move back to invited, or cancel (with undo). */
export function useSetShiftStatus() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const write = async (id: string, status: ShiftStatus) => {
    const responded_at = status === 'confirmed' || status === 'declined' ? new Date().toISOString() : null;
    const { error } = await supabase.from('volunteer_shifts').update({ status, responded_at }).eq('id', id);
    if (error) throw error;
  };
  return useMutation({
    mutationFn: async (v: { shift: Pick<Shift, 'id' | 'status'>; status: ShiftStatus; name: string }) => write(v.shift.id, v.status),
    onSuccess: (_d, v) => {
      invalidate();
      const prev = v.shift.status;
      const text = v.status === 'cancelled' ? `השיבוץ של ${v.name} בוטל` : `${v.name}: ${STATUS_LABEL[v.status]}`;
      toast.undo(text, () => { write(v.shift.id, prev).then(invalidate, (e) => toast.error(errorMessage(e))); });
    },
    onError: (e) => {
      invalidate();
      toast.error(errorMessage(e));
    },
  });
}

/** The volunteer's personal link. A new link replaces the previous one. */
export const createVolunteerLink = async (volunteerId: string) =>
  must(await supabase.rpc('staff_volunteer_link', { p_volunteer_id: volunteerId })) as string;
