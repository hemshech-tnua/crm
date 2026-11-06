import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomInt, randomUUID } from 'node:crypto';
import { ANON_KEY, API_URL } from './env';

export const PASSWORD = 'Local-Test-2026';
export const SITE_ID = '00000000-0000-4000-8000-000000000001';

/** A visitor with its own (simulated) IP so per-IP rate limits of one test do not affect another. */
export function visitor(ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(255)}`): SupabaseClient {
  return createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'cf-connecting-ip': ip } },
  });
}

const sessions = new Map<string, SupabaseClient>();
export async function staff(role: 'admin' | 'coord' | 'door'): Promise<SupabaseClient> {
  const cached = sessions.get(role);
  if (cached) return cached;
  const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: `${role}@example.test`, password: PASSWORD });
  if (error) throw error;
  sessions.set(role, c);
  return c;
}

export async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

/** Fictitious Israeli mobile number, unique per call. */
export function phone(): string {
  return `05${randomInt(0, 10)}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

export function e164(local: string): string {
  return '+972' + local.replace(/\D/g, '').slice(1);
}

const HEBREW_FIRST = ['נועם', 'יואב', 'מאיה', 'איתי', 'שירה', 'עומר', 'דניאל', 'תמר', 'אורי', 'רוני', 'גיא', 'נטע'];
const HEBREW_LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'שפירא', 'גולן', 'ברק'];
export function name(): string {
  return `${HEBREW_FIRST[randomInt(HEBREW_FIRST.length)]} ${HEBREW_LAST[randomInt(HEBREW_LAST.length)]} ${randomUUID().slice(0, 4).replace(/\d/g, 'א')}`;
}

export type EventRow = { id: string; public_code: string; checkin_code: string; starts_at: string; status: string };

/** Create an event as a coordinator. Defaults: Friday, open, starts in 3 days. */
export async function makeEvent(overrides: Record<string, unknown> = {}, as: 'admin' | 'coord' = 'coord'): Promise<EventRow> {
  const c = await staff(as);
  const startsIn = (overrides.startsInMinutes as number | undefined) ?? 3 * 24 * 60;
  const starts = new Date(Date.now() + startsIn * 60_000);
  const ends = new Date(starts.getTime() + 150 * 60_000);
  const row = {
    site_id: SITE_ID,
    type: 'friday',
    title: 'מפגש שישי (בדיקה)',
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    capacity: 40,
    status: 'open',
    ...overrides,
  };
  delete (row as Record<string, unknown>).startsInMinutes;
  const { data, error } = await c.from('events').insert(row).select('id, public_code, checkin_code, starts_at, status').single();
  if (error) throw error;
  return data as EventRow;
}

export function registration(eventCode: string, extra: Record<string, unknown> = {}) {
  return {
    event: eventCode,
    full_name: name(),
    phone: phone(),
    city: 'מודיעין',
    age: '29',
    source: 'instagram',
    consent_updates: false,
    ...extra,
  };
}

/** Expect a Supabase call to fail with the given error code (message) or HTTP status. */
export function errorCode(error: { message?: string; code?: string } | null): string | undefined {
  return error?.message;
}
