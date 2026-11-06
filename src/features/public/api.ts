// Typed wrappers around the public API (supabase/migrations/…0400_public_api.sql is the source of truth).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorCode, must } from '@/lib/errors';
import type { Attendance, PublicEvent, RegStatus } from '@/lib/types';

export type PublicSource = { key: string; label: string; is_friend: boolean; asks_detail: boolean };

export type RegisterStatus = 'registered' | 'waitlisted' | 'already_registered' | 'already_waitlisted';
export type RegisterResult = {
  status: RegisterStatus;
  first_name: string | null;
  token?: string | null;
  invite_code?: string | null;
  waitlist_position?: number | null;
  event?: PublicEvent;
};

export type RegistrationInfo = {
  status: RegStatus;
  attendance: Attendance;
  first_name: string | null;
  invite_code: string | null;
  waitlist_position: number | null;
  can_cancel: boolean;
  feedback_open: boolean;
  feedback_given: boolean;
  event: PublicEvent;
};

export type CheckinWindow = 'open' | 'not_open' | 'closed' | 'unavailable';
export type CheckinInfo = { window: CheckinWindow; opens_at: string; event: PublicEvent };

export type CheckinOutcome =
  | 'checked_in'
  | 'already_checked_in'
  | 'not_registered'
  | 'token_invalid'
  | 'window_not_open'
  | 'window_closed'
  | 'window_unavailable';
export type CheckinResult = {
  result: CheckinOutcome;
  first_name?: string | null;
  token?: string | null;
  friday_count?: number;
  attended_count?: number;
  photo_opt_out?: boolean;
  invite_code?: string | null;
  opens_at?: string;
  event?: PublicEvent;
};

export type FeedbackRatings = { overall: number | null; activity: number | null; lecture: number | null; comment: string | null };
export type FeedbackContext = {
  state: 'open' | 'not_yet' | 'closed';
  first_name: string | null;
  personal: boolean;
  has_activity: boolean;
  has_lecture: boolean;
  existing: FeedbackRatings | null;
  event: PublicEvent;
};

/** Person fields shared by registration and the walk-in form at the door. */
export type PersonPayload = {
  full_name: string;
  phone: string;
  city: string;
  age: string;
  source: string;
  source_detail?: string;
  referrer?: string;
  consent_updates: boolean;
  photo_opt_out: boolean;
  website: string;
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return must(await supabase.rpc(fn, args)) as T;
}

/** Retry only when the network failed; a known server answer (event_not_found, token_invalid…) is final. */
const retry = (count: number, err: unknown) => errorCode(err) === 'network' && count < 2;

export const usePublicEvents = () =>
  useQuery({ queryKey: ['pub', 'events'], retry, queryFn: () => rpc<PublicEvent[]>('public_list_events') });

export const usePublicEvent = (code: string, ref: string | null) =>
  useQuery({
    queryKey: ['pub', 'event', code, ref],
    retry,
    queryFn: () => rpc<PublicEvent>('public_get_event', { p_code: code, p_ref: ref }),
  });

export const usePublicSources = () =>
  useQuery({ queryKey: ['pub', 'sources'], retry, staleTime: 10 * 60_000, queryFn: () => rpc<PublicSource[]>('public_sources') });

export const useRegistration = (token: string | null) =>
  useQuery({
    queryKey: ['pub', 'registration', token],
    enabled: !!token,
    retry,
    queryFn: () => rpc<RegistrationInfo>('public_registration', { p_token: token }),
  });

export const useCheckinInfo = (code: string) =>
  useQuery({
    queryKey: ['pub', 'checkin', code],
    retry,
    // waiting at the entrance before the window opens: the page opens by itself
    refetchInterval: (q) => (q.state.data?.window === 'not_open' ? 60_000 : false),
    queryFn: () => rpc<CheckinInfo>('public_checkin_info', { p_code: code }),
  });

export const useFeedbackContext = (by: { token: string } | { event: string }) =>
  useQuery({
    queryKey: ['pub', 'feedback', by],
    retry,
    // the form is filled from this once; refetching while someone types would not change it
    refetchOnWindowFocus: false,
    queryFn: () => rpc<FeedbackContext>('public_feedback_context', { p: by }),
  });

export const registerFor = (p: PersonPayload & { event: string; ref?: string | null; utm?: Record<string, string> }) =>
  rpc<RegisterResult>('public_register', { p });

export const cancelRegistration = (token: string, reason: string | null) =>
  rpc<{ status: 'cancelled' }>('public_cancel', { p_token: token, p_reason: reason });

export const checkIn = (p: { code: string; token?: string; phone?: string }) => rpc<CheckinResult>('public_checkin', { p });

export const walkIn = (p: PersonPayload & { code: string }) => rpc<CheckinResult>('public_walkin', { p });

export const submitFeedback = (p: {
  token?: string;
  event?: string;
  phone?: string;
  overall: number;
  activity?: number | null;
  lecture?: number | null;
  comment?: string | null;
  website: string;
}) => rpc<{ ok: boolean }>('public_submit_feedback', { p });

export const propose = (p: {
  kind: 'speaker' | 'instructor';
  full_name: string;
  phone: string;
  topic: string;
  bio_line?: string;
  social_url?: string;
  message?: string;
  website: string;
}) => rpc<{ ok: boolean }>('public_propose', { p });
