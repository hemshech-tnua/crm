// Queries and mutations shared by the event screens (office, door and marketing).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { must } from '@/lib/errors';
import type { EventWithStats } from '@/lib/data';
import type { Attendance, ContactLog, EventRow, EventStats, EventType, Feedback, RegStatus, Registration } from '@/lib/types';

export const eventKeys = {
  registrations: (id: string) => ['event-registrations', id] as const,
  checkin: (id: string) => ['checkin', id] as const,
  sent: (id: string) => ['messages_sent', id] as const,
  feedback: (id: string) => ['event-feedback', id] as const,
  audience: (id: string, group: string) => ['event-audience', id, group] as const,
  door: () => ['door-events'] as const,
};

/** After any change to an event or its registrations: lists, the event, its registrations and the door list. */
export function useInvalidateEvent() {
  const qc = useQueryClient();
  return (id: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['events'] }),
      qc.invalidateQueries({ queryKey: ['event', id] }),
      qc.invalidateQueries({ queryKey: eventKeys.registrations(id) }),
      qc.invalidateQueries({ queryKey: eventKeys.checkin(id) }),
      qc.invalidateQueries({ queryKey: ['event-audience', id] }),
      qc.invalidateQueries({ queryKey: eventKeys.door() }),
      // screens of other areas that show registrations or tasks
      qc.invalidateQueries({ queryKey: ['participant'] }),
      qc.invalidateQueries({ queryKey: ['participants'] }),
      qc.invalidateQueries({ queryKey: ['attention'] }),
    ]);
}

/** Splits ids for `in.(…)` filters: a long list makes the URL too long for the API gateway (about 8 KB). */
export function chunk<T>(xs: T[], size = 60): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

// ───────────── events list ─────────────

/**
 * Events with their stats, like lib/data useEventsWithStats, but the stats are fetched in chunks:
 * one `in.(…)` filter with hundreds of ids makes the URL too long for the API gateway.
 */
export function useEventList(opts: { from?: string; to?: string; ascending: boolean; limit?: number }) {
  return useQuery({
    queryKey: ['events', 'list', opts],
    queryFn: async (): Promise<EventWithStats[]> => {
      let q = supabase.from('events').select('*').order('starts_at', { ascending: opts.ascending });
      if (opts.from) q = q.gte('starts_at', opts.from);
      if (opts.to) q = q.lt('starts_at', opts.to);
      if (opts.limit) q = q.limit(opts.limit);
      const events = must(await q) as EventRow[];
      const stats = (
        await Promise.all(chunk(events.map((e) => e.id)).map(async (c) => must(await supabase.from('event_stats').select('*').in('event_id', c)) as EventStats[]))
      ).flat();
      const byId = new Map(stats.map((x) => [x.event_id, x]));
      return events.map((e) => ({ ...e, stats: byId.get(e.id) ?? null }));
    },
  });
}

// ───────────── registrations (office view) ─────────────

export type RegParticipant = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  consent_updates: boolean;
  photo_opt_out: boolean;
  anonymized_at: string | null;
};

export type RegRow = Registration & {
  participant: RegParticipant | null;
  referrer: { id: string; full_name: string | null } | null;
  link: { label: string; code: string } | null;
  source: { label: string } | null;
  /** No attendance at any activity before this event. */
  first_time: boolean;
  attended_total: number;
};

const REG_SELECT =
  '*, participant:participants!registrations_participant_id_fkey(id, full_name, phone, city, consent_updates, photo_opt_out, anonymized_at),' +
  ' referrer:participants!registrations_referrer_participant_id_fkey(id, full_name),' +
  ' link:referral_links(label, code), source:acquisition_sources(label)';

export function useEventRegistrations(event: Pick<EventRow, 'id' | 'starts_at'> | undefined) {
  return useQuery({
    queryKey: eventKeys.registrations(event?.id ?? ''),
    enabled: !!event,
    queryFn: async (): Promise<RegRow[]> => {
      const rows = must(
        await supabase.from('registrations').select(REG_SELECT).eq('event_id', event!.id).order('registered_at'),
      ) as unknown as Omit<RegRow, 'first_time' | 'attended_total'>[];
      const ids = rows.map((r) => r.participant_id);
      type S = { participant_id: string; attended_count: number; first_attended_at: string | null };
      const stats = (
        await Promise.all(chunk(ids).map(async (c) =>
          must(await supabase.from('participant_stats').select('participant_id, attended_count, first_attended_at').in('participant_id', c)) as S[]))
      ).flat();
      const byId = new Map(stats.map((s) => [s.participant_id, s]));
      const start = new Date(event!.starts_at).getTime();
      return rows.map((r) => {
        const s = byId.get(r.participant_id);
        const first = s?.first_attended_at ? new Date(s.first_attended_at).getTime() : null;
        return { ...r, first_time: first == null || first >= start, attended_total: s?.attended_count ?? 0 };
      });
    },
  });
}

// ───────────── attendance list (door) ─────────────

export type CheckinRow = {
  registration_id: string;
  participant_id: string | null;
  display_name: string;
  phone_last4: string | null;
  phone: string | null;
  status: RegStatus;
  attendance: Attendance;
  is_walk_in: boolean;
  checked_in_at: string | null;
  checkin_method: 'self_qr' | 'staff' | null;
  registered_at: string;
  photo_opt_out: boolean;
  prior_attended: number;
  prior_fridays: number;
  first_time: boolean;
  status_rank: number;
  waitlist_position: number | null;
};

export async function fetchCheckinList(eventId: string): Promise<CheckinRow[]> {
  const { data, error } = await supabase.rpc('staff_checkin_list', { p_event_id: eventId });
  if (error) throw error;
  return (data ?? []) as CheckinRow[];
}

/** The basic event fields every staff role may read (the door team cannot read event_stats rows). */
export type DoorEvent = Pick<EventRow, 'id' | 'title' | 'type' | 'starts_at' | 'ends_at' | 'status' | 'location'>;
const DOOR_FIELDS = 'id, title, type, starts_at, ends_at, status, location';

export function useDoorEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['event', id, 'door'],
    enabled: !!id,
    queryFn: async () => must(await supabase.from('events').select(DOOR_FIELDS).eq('id', id!).single()) as DoorEvent,
  });
}

/** Events around now: today (Israel) and anything within ±12 hours, plus the next one after that. */
export function useDoorEvents() {
  return useQuery({
    queryKey: eventKeys.door(),
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = Date.now();
      const from = new Date(now - 36 * 3600_000).toISOString();
      const to = new Date(now + 36 * 3600_000).toISOString();
      const around = must(
        await supabase.from('events').select(DOOR_FIELDS).neq('status', 'draft').gte('starts_at', from).lte('starts_at', to).order('starts_at'),
      ) as DoorEvent[];
      const next = must(
        await supabase.from('events').select(DOOR_FIELDS).in('status', ['open', 'closed']).gt('starts_at', to).order('starts_at').limit(1),
      ) as DoorEvent[];
      return { around, next: next[0] ?? null };
    },
  });
}

// ───────────── messages and feedback ─────────────

export function useSentForEvent(eventId: string) {
  return useQuery({
    queryKey: eventKeys.sent(eventId),
    queryFn: async () =>
      must(
        await supabase.from('contact_log').select('id, participant_id, template_key, channel, created_at').eq('event_id', eventId).order('created_at', { ascending: false }),
      ) as Pick<ContactLog, 'id' | 'participant_id' | 'template_key' | 'channel' | 'created_at'>[],
  });
}

export function useEventFeedback(eventId: string, enabled = true) {
  return useQuery({
    queryKey: eventKeys.feedback(eventId),
    enabled,
    queryFn: async () =>
      must(await supabase.from('feedback').select('*').eq('event_id', eventId).order('created_at', { ascending: false })) as Feedback[],
  });
}

export type AudiencePerson = { id: string; full_name: string | null; phone: string | null; consent_updates: boolean; last_attended_at?: string | null };

/**
 * People who agreed to updates and came to something in the last 90 days, and are not registered to this event:
 * the audience for "invite to the next meeting".
 */
export function useConsentedRecent(eventId: string, excludeIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: eventKeys.audience(eventId, 'consented'),
    enabled,
    queryFn: async (): Promise<AudiencePerson[]> => {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const stats = must(
        await supabase.from('participant_stats').select('participant_id, last_attended_at').gte('last_attended_at', since),
      ) as { participant_id: string; last_attended_at: string }[];
      if (!stats.length) return [];
      const last = new Map(stats.map((s) => [s.participant_id, s.last_attended_at]));
      const people = (
        await Promise.all(chunk(stats.map((x) => x.participant_id)).map(async (c) =>
          must(await supabase.from('participants').select('id, full_name, phone, consent_updates')
            .in('id', c).eq('consent_updates', true).is('anonymized_at', null)) as AudiencePerson[]))
      ).flat();
      const skip = new Set(excludeIds);
      return people
        .filter((p) => !skip.has(p.id))
        .map((p) => ({ ...p, last_attended_at: last.get(p.id) ?? null }))
        .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'he'));
    },
  });
}

// ───────────── helpers ─────────────

export const DEFAULT_TITLE: Record<EventType, string> = { friday: 'מפגש שישי', bonfire: 'ערב מדורה', other: '' };
export const DEFAULT_TIMES: Record<EventType, [string, string]> = { friday: ['09:00', '11:30'], bonfire: ['19:30', '22:00'], other: ['18:00', '20:00'] };

/** Characters that would break a PostgREST or() filter are dropped from a free-text search. */
export const cleanSearch = (q: string) => q.replace(/[,()*%\\:"'.]/g, ' ').replace(/\s+/g, ' ').trim();
