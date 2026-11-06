// Queries behind the participant card (כרטיס לוחם). All keys start with ['participant', id] so one
// invalidation refreshes the card; the contact log keeps ['contact_log', id] (MessageComposer logs into it).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { must } from '@/lib/errors';
import type { ContactLog, Participant, ParticipantStats, RegStatus, Attendance, EventType, EventStatus } from '@/lib/types';
import { TASK_SELECT, type TaskRow } from '@/features/followups/shared';
import { EVENT_FOR_MESSAGE, type EventForMessage } from './shared';

export type Card = Participant & {
  first_source: { label: string; key: string; asks_detail: boolean } | null;
  referrer: { id: string; full_name: string | null } | null;
  friends: { id: string; full_name: string | null; created_at: string; anonymized_at: string | null }[];
};

export type RegEvent = EventForMessage & { type: EventType; status: EventStatus };
export type CardRegistration = {
  id: string;
  status: RegStatus;
  attendance: Attendance;
  is_walk_in: boolean;
  registered_at: string;
  cancelled_at: string | null;
  cancelled_by: 'participant' | 'staff' | null;
  checked_in_at: string | null;
  checkin_method: 'self_qr' | 'staff' | null;
  how_heard_detail: string | null;
  referrer_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_via: string;
  event: RegEvent | null;
  how_heard: { label: string } | null;
  link: { code: string; label: string } | null;
  referrer: { id: string; full_name: string | null } | null;
};

export type CardFeedback = {
  id: string;
  event_id: string;
  registration_id: string | null;
  overall_rating: number;
  activity_rating: number | null;
  lecture_rating: number | null;
  comment: string | null;
  created_at: string;
  event: { id: string; title: string; starts_at: string } | null;
};

const CARD_SELECT =
  '*, first_source:acquisition_sources(label,key,asks_detail), referrer:referred_by_participant_id(id,full_name), friends:participants!referred_by_participant_id(id,full_name,created_at,anonymized_at)';
const REG_SELECT =
  `id,status,attendance,is_walk_in,registered_at,cancelled_at,cancelled_by,checked_in_at,checkin_method,how_heard_detail,referrer_name,utm_source,utm_medium,utm_campaign,created_via,event:events(${EVENT_FOR_MESSAGE},type,status),how_heard:acquisition_sources(label),link:referral_links(code,label),referrer:participants!referrer_participant_id(id,full_name)`;

export const useCard = (id: string) =>
  useQuery({
    queryKey: ['participant', id],
    queryFn: async () => must(await supabase.from('participants').select(CARD_SELECT).eq('id', id).maybeSingle()) as unknown as Card | null,
  });

export const useCardStats = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['participant', id, 'stats'],
    enabled,
    queryFn: async () => must(await supabase.from('participant_stats').select('*').eq('participant_id', id).maybeSingle()) as ParticipantStats | null,
  });

export const useCardRegistrations = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['participant', id, 'registrations'],
    enabled,
    queryFn: async () => must(await supabase.from('registrations').select(REG_SELECT).eq('participant_id', id)) as unknown as CardRegistration[],
  });

export const useCardFeedback = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['participant', id, 'feedback'],
    enabled,
    queryFn: async () =>
      must(await supabase.from('feedback').select('id,event_id,registration_id,overall_rating,activity_rating,lecture_rating,comment,created_at,event:events(id,title,starts_at)')
        .eq('participant_id', id).order('created_at', { ascending: false })) as unknown as CardFeedback[],
  });

export const useCardTasks = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['participant', id, 'followups'],
    enabled,
    queryFn: async () => must(await supabase.from('follow_ups').select(TASK_SELECT).eq('participant_id', id).order('created_at', { ascending: false })) as unknown as TaskRow[],
  });

export const useContactLog = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['contact_log', id],
    enabled,
    queryFn: async () => must(await supabase.from('contact_log').select('*').eq('participant_id', id).order('created_at', { ascending: false })) as ContactLog[],
  });
