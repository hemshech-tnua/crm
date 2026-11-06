// Roster queries. `participant_stats` is a view that PostgREST cannot join to `participants` (it only sees the
// self-referencing referred_by key), so filters on each side run on the server and the two are combined here:
//  • the side that decides the order is queried with range() and an exact count;
//  • the other side's filters become an id list pushed into that query when it is short,
//    or, for broad combinations, both ordered id lists are intersected here and only the visible page is loaded.
import { supabase } from '@/lib/supabase';
import { must } from '@/lib/errors';
import type { Engagement } from '@/lib/types';
import { searchOrFilter } from './shared';

export type RosterSort = 'last' | 'fridays' | 'name' | 'joined';
export type RosterFilters = {
  q: string;
  status: Engagement | '';
  source: string; // acquisition source id, 'none', or ''
  city: string;
  task: boolean; // has an open follow-up
  consent: '' | 'yes' | 'no';
  sort: RosterSort;
};

export type RosterStats = {
  participant_id: string;
  engagement_status: Engagement;
  friday_count: number;
  attended_count: number;
  last_attended_at: string | null;
  first_attended_at: string | null;
  no_show_count: number;
};
export type RosterRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  birth_year: number | null;
  birth_date: string | null;
  first_source_id: string | null;
  first_source_detail: string | null;
  consent_updates: boolean;
  photo_opt_out: boolean;
  created_at: string;
  stats: RosterStats | null;
};

const P_COLS = 'id,full_name,phone,city,birth_year,birth_date,first_source_id,first_source_detail,consent_updates,photo_opt_out,created_at';
const S_COLS = 'participant_id,engagement_status,friday_count,attended_count,last_attended_at,first_attended_at,no_show_count';
/** ids per request: keeps the URL far below the gateway's limit */
const CHUNK = 150;
const MAX_ROWS = 1000; // PostgREST max_rows

/** The part of the PostgREST query builder used here (keeps types simple across tables and views). */
type Res = { data: unknown; error: unknown; count: number | null };
interface Q extends PromiseLike<Res> {
  is(column: string, value: null | boolean): Q;
  or(filter: string): Q;
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  not(column: string, operator: string, value: unknown): Q;
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): Q;
  range(from: number, to: number): PromiseLike<Res>;
}
const sel = (table: string, cols: string, opts?: { count?: 'exact'; head?: boolean }): Q =>
  supabase.from(table).select(cols, opts) as unknown as Q;

const statsSort = (s: RosterSort) => s === 'last' || s === 'fridays';

function applyP(q: Q, f: RosterFilters): Q {
  let out = q.is('anonymized_at', null);
  const or = searchOrFilter(f.q);
  if (or) out = out.or(or);
  if (f.city) out = out.eq('city', f.city);
  if (f.source === 'none') out = out.is('first_source_id', null);
  else if (f.source) out = out.eq('first_source_id', f.source);
  if (f.consent) out = out.eq('consent_updates', f.consent === 'yes');
  return out;
}
const orderP = (q: Q, sort: RosterSort): Q =>
  sort === 'joined' ? q.order('created_at', { ascending: false }).order('id') : q.order('full_name').order('id');

const applyS = (q: Q, f: RosterFilters): Q => (f.status ? q.eq('engagement_status', f.status) : q);
const orderS = (q: Q, sort: RosterSort): Q =>
  sort === 'fridays'
    ? q.order('friday_count', { ascending: false }).order('last_attended_at', { ascending: false, nullsFirst: false }).order('participant_id')
    : q.order('last_attended_at', { ascending: false, nullsFirst: false }).order('friday_count', { ascending: false }).order('participant_id');

const hasPFilters = (f: RosterFilters) => !!(searchOrFilter(f.q) || f.city || f.source || f.consent);

async function allRows<T>(build: () => Q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += MAX_ROWS) {
    const rows = must(await build().range(from, from + MAX_ROWS - 1)) as T[];
    out.push(...rows);
    if (rows.length < MAX_ROWS) return out;
  }
}

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const intersect = (a: string[] | null, b: string[]): string[] => {
  if (a == null) return b;
  const set = new Set(b);
  return a.filter((x) => set.has(x));
};

async function statsFor(ids: string[]): Promise<Map<string, RosterStats>> {
  const parts = await Promise.all(chunks(ids).map(async (c) => must(await sel('participant_stats', S_COLS).in('participant_id', c)) as RosterStats[]));
  return new Map(parts.flat().map((s) => [s.participant_id, s]));
}
async function peopleFor(ids: string[]): Promise<Map<string, Omit<RosterRow, 'stats'>>> {
  const parts = await Promise.all(chunks(ids).map(async (c) => must(await sel('participants', P_COLS).in('id', c)) as Omit<RosterRow, 'stats'>[]));
  return new Map(parts.flat().map((p) => [p.id, p]));
}

/** Rows for these ids, in this order. */
export async function rosterDetails(ids: string[]): Promise<RosterRow[]> {
  if (!ids.length) return [];
  const [people, stats] = await Promise.all([peopleFor(ids), statsFor(ids)]);
  return ids.flatMap((id) => {
    const p = people.get(id);
    return p ? [{ ...p, stats: stats.get(id) ?? null }] : [];
  });
}

/** The id list that limits the driving query (null = no limit), from the filters that live on the other side. */
async function constraintFor(f: RosterFilters, openIds: string[] | null): Promise<string[] | null> {
  let c: string[] | null = f.task ? openIds ?? [] : null;
  if (statsSort(f.sort)) {
    if (hasPFilters(f)) c = intersect(c, (await allRows<{ id: string }>(() => applyP(sel('participants', 'id'), f))).map((r) => r.id));
  } else if (f.status) {
    c = intersect(c, (await allRows<{ participant_id: string }>(() => applyS(sel('participant_stats', 'participant_id'), f))).map((r) => r.participant_id));
  }
  return c;
}

/** Every matching id, in display order (export, and broad filter combinations). */
async function orderedIds(f: RosterFilters, constraint: string[] | null): Promise<string[]> {
  const ids = statsSort(f.sort)
    ? (await allRows<{ participant_id: string }>(() => orderS(applyS(sel('participant_stats', 'participant_id'), f), f.sort))).map((r) => r.participant_id)
    : (await allRows<{ id: string }>(() => orderP(applyP(sel('participants', 'id'), f), f.sort))).map((r) => r.id);
  if (!constraint) return ids;
  const set = new Set(constraint);
  return ids.filter((id) => set.has(id));
}

/** First `limit` rows of the roster and the total count. */
export async function fetchRoster(f: RosterFilters, limit: number, openIds: string[] | null): Promise<{ rows: RosterRow[]; total: number }> {
  const constraint = await constraintFor(f, openIds);
  if (constraint && constraint.length === 0) return { rows: [], total: 0 };

  if (!constraint || constraint.length <= CHUNK) {
    if (statsSort(f.sort)) {
      let q = applyS(sel('participant_stats', S_COLS, { count: 'exact' }), f);
      if (constraint) q = q.in('participant_id', constraint);
      const res = await orderS(q, f.sort).range(0, limit - 1);
      const stats = must(res) as unknown as RosterStats[];
      const people = await peopleFor(stats.map((s) => s.participant_id));
      return {
        rows: stats.flatMap((s) => { const p = people.get(s.participant_id); return p ? [{ ...p, stats: s }] : []; }),
        total: res.count ?? stats.length,
      };
    }
    let q = applyP(sel('participants', P_COLS, { count: 'exact' }), f);
    if (constraint) q = q.in('id', constraint);
    const res = await orderP(q, f.sort).range(0, limit - 1);
    const people = must(res) as unknown as Omit<RosterRow, 'stats'>[];
    const stats = await statsFor(people.map((p) => p.id));
    return { rows: people.map((p) => ({ ...p, stats: stats.get(p.id) ?? null })), total: res.count ?? people.length };
  }

  const ids = await orderedIds(f, constraint);
  return { rows: await rosterDetails(ids.slice(0, limit)), total: ids.length };
}

/** The whole filtered roster (CSV export). */
export async function fetchRosterAll(f: RosterFilters, openIds: string[] | null): Promise<RosterRow[]> {
  const constraint = await constraintFor(f, openIds);
  if (constraint && constraint.length === 0) return [];
  const ids = await orderedIds(f, constraint);
  const out: RosterRow[] = [];
  for (const part of chunks(ids, CHUNK * 4)) out.push(...(await rosterDetails(part)));
  return out;
}

/** Participant ids with an open follow-up task. */
export async function openTaskIds(): Promise<string[]> {
  const rows = await allRows<{ participant_id: string }>(() => sel('follow_ups', 'participant_id').eq('status', 'open').order('participant_id'));
  return [...new Set(rows.map((r) => r.participant_id))];
}

/** Cities with how many participants live there, most common first. */
export async function cityCounts(): Promise<{ city: string; n: number }[]> {
  const rows = await allRows<{ city: string }>(() => sel('participants', 'city').is('anonymized_at', null).not('city', 'is', null).order('city'));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.city, (m.get(r.city) ?? 0) + 1);
  return [...m.entries()].map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n || a.city.localeCompare(b.city, 'he'));
}

/** How many participants are in each engagement status (for the filter chips). */
export async function engagementCounts(): Promise<Record<Engagement | 'all', number>> {
  const statuses: Engagement[] = ['registered', 'first_timer', 'returning', 'regular', 'lapsed'];
  const counts = await Promise.all(statuses.map(async (s) => {
    const { count, error } = await sel('participant_stats', 'participant_id', { count: 'exact', head: true }).eq('engagement_status', s);
    if (error) throw error;
    return [s, count ?? 0] as const;
  }));
  const out = Object.fromEntries(counts) as Record<Engagement | 'all', number>;
  out.all = counts.reduce((a, [, n]) => a + n, 0);
  return out;
}
