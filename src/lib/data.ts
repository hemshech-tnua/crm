// Shared queries for reference data used across screens.
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { must } from './errors';
import type { EventRow, EventStats, ReferralLink, Settings, Site, Source, Speaker, Staff, Template } from './types';

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    staleTime: 5 * 60_000,
    queryFn: async () => must(await supabase.from('settings').select('*').single()) as Settings,
  });

export const useSources = () =>
  useQuery({
    queryKey: ['sources'],
    staleTime: 5 * 60_000,
    queryFn: async () => must(await supabase.from('acquisition_sources').select('*').order('sort_order')) as Source[],
  });

export const useSites = () =>
  useQuery({
    queryKey: ['sites'],
    staleTime: 5 * 60_000,
    queryFn: async () => must(await supabase.from('sites').select('*').order('name')) as Site[],
  });

export const useStaffList = () =>
  useQuery({
    queryKey: ['staff'],
    staleTime: 60_000,
    queryFn: async () => must(await supabase.from('staff').select('*').order('full_name')) as Staff[],
  });

export const useSpeakers = () =>
  useQuery({
    queryKey: ['speakers'],
    queryFn: async () => must(await supabase.from('speakers').select('*').order('full_name')) as Speaker[],
  });

export const useTemplates = () =>
  useQuery({
    queryKey: ['templates'],
    staleTime: 5 * 60_000,
    queryFn: async () => must(await supabase.from('message_templates').select('*').order('sort_order')) as Template[],
  });

export const useReferralLinks = () =>
  useQuery({
    queryKey: ['links'],
    queryFn: async () => must(await supabase.from('referral_links').select('*').order('created_at', { ascending: false })) as ReferralLink[],
  });

export type EventWithStats = EventRow & { stats: EventStats | null };

/** Events with their stats (two queries joined in the client: stats is a view). */
export const useEventsWithStats = (opts: { from?: string; to?: string; ascending?: boolean; limit?: number } = {}) =>
  useQuery({
    queryKey: ['events', opts],
    queryFn: async (): Promise<EventWithStats[]> => {
      let q = supabase.from('events').select('*').order('starts_at', { ascending: opts.ascending ?? true });
      if (opts.from) q = q.gte('starts_at', opts.from);
      if (opts.to) q = q.lt('starts_at', opts.to);
      if (opts.limit) q = q.limit(opts.limit);
      const events = must(await q) as EventRow[];
      if (!events.length) return [];
      // in chunks: a single in.(…) with hundreds of ids exceeds the gateway's URL limit
      const ids = events.map((e) => e.id);
      const stats: EventStats[] = [];
      for (let i = 0; i < ids.length; i += 60) {
        stats.push(...(must(await supabase.from('event_stats').select('*').in('event_id', ids.slice(i, i + 60))) as EventStats[]));
      }
      const byId = new Map(stats.map((s) => [s.event_id, s]));
      return events.map((e) => ({ ...e, stats: byId.get(e.id) ?? null }));
    },
  });

export const useEvent = (id: string | undefined) =>
  useQuery({
    queryKey: ['event', id],
    enabled: !!id,
    queryFn: async (): Promise<EventWithStats> => {
      const e = must(await supabase.from('events').select('*').eq('id', id!).maybeSingle()) as EventRow | null;
      if (!e) throw { message: 'not_found' };
      const { data: stats } = await supabase.from('event_stats').select('*').eq('event_id', id!).maybeSingle();
      return { ...e, stats: (stats as EventStats) ?? null };
    },
  });
