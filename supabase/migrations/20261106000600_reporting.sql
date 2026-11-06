-- Reporting layer. Every number on the dashboard and in reports comes from here, so the definitions
-- (docs/01-spec.md §6) live in one place. Views are security_invoker: Row Level Security applies,
-- so the door team (volunteer) gets no rows.

create or replace function private.in_period(p_at timestamptz, p_from date, p_to date)
returns boolean language sql stable set search_path = '' as $$
  select (p_from is null or (p_at at time zone 'Asia/Jerusalem')::date >= p_from)
     and (p_to is null or (p_at at time zone 'Asia/Jerusalem')::date <= p_to)
$$;
grant execute on function private.in_period(timestamptz, date, date) to authenticated;

-- Per participant: counts, dates and engagement status (new / returning / regular / lapsed).
create or replace view public.participant_stats with (security_invoker = true) as
with s as (
  select regular_min_fridays, regular_window_days, lapsed_after_fridays from public.settings limit 1
),
att as (
  select r.participant_id, e.id as event_id, e.type, e.site_id, e.starts_at
  from public.registrations r join public.events e on e.id = r.event_id
  where r.attendance = 'attended'
),
agg as (
  select a.participant_id,
         count(*)::int as attended_count,
         count(*) filter (where a.type = 'friday')::int as friday_count,
         count(*) filter (where a.type = 'bonfire')::int as bonfire_count,
         min(a.starts_at) as first_attended_at,
         max(a.starts_at) as last_attended_at,
         max(a.starts_at) filter (where a.type = 'friday') as last_friday_at,
         count(*) filter (where a.type = 'friday' and a.starts_at >= now() - make_interval(days => (select regular_window_days from s)))::int
           as recent_fridays
  from att a group by a.participant_id
),
ever_regular as (
  select distinct x.participant_id from (
    select a.participant_id, a.starts_at,
           lag(a.starts_at, (select regular_min_fridays from s) - 1) over (partition by a.participant_id order by a.starts_at) as prev
    from att a where a.type = 'friday'
  ) x
  where x.prev is not null and x.starts_at - x.prev <= make_interval(days => (select regular_window_days from s))
),
home_site as (
  select distinct on (a.participant_id) a.participant_id, a.site_id
  from att a where a.type = 'friday' order by a.participant_id, a.starts_at desc
),
regs as (
  select r.participant_id,
         count(*)::int as registrations_count,
         count(*) filter (where r.attendance = 'no_show')::int as no_show_count,
         count(*) filter (where r.status = 'cancelled')::int as cancel_count,
         max(r.registered_at) as last_registered_at
  from public.registrations r group by r.participant_id
),
fb as (
  select f.participant_id, count(*)::int as feedback_count, round(avg(f.overall_rating), 2) as avg_rating_given
  from public.feedback f where f.participant_id is not null group by f.participant_id
),
friends as (
  select p.referred_by_participant_id as participant_id, count(*)::int as friends_brought
  from public.participants p where p.referred_by_participant_id is not null group by 1
)
select
  p.id as participant_id,
  coalesce(a.attended_count, 0) as attended_count,
  coalesce(a.friday_count, 0) as friday_count,
  coalesce(a.bonfire_count, 0) as bonfire_count,
  a.first_attended_at,
  a.last_attended_at,
  a.last_friday_at,
  coalesce(rg.registrations_count, 0) as registrations_count,
  coalesce(rg.no_show_count, 0) as no_show_count,
  coalesce(rg.cancel_count, 0) as cancel_count,
  rg.last_registered_at,
  coalesce(fb.feedback_count, 0) as feedback_count,
  fb.avg_rating_given,
  coalesce(fr.friends_brought, 0) as friends_brought,
  er.participant_id is not null as ever_regular,
  coalesce(a.recent_fridays, 0) >= s.regular_min_fridays as is_regular,
  coalesce(missed.n, 0) as fridays_missed,
  case
    when coalesce(a.attended_count, 0) = 0 then 'registered'
    when coalesce(a.recent_fridays, 0) >= s.regular_min_fridays then 'regular'
    when er.participant_id is not null and coalesce(missed.n, 0) >= s.lapsed_after_fridays then 'lapsed'
    when a.attended_count = 1 then 'first_timer'
    else 'returning'
  end as engagement_status
from public.participants p
cross join s
left join agg a on a.participant_id = p.id
left join regs rg on rg.participant_id = p.id
left join fb on fb.participant_id = p.id
left join friends fr on fr.participant_id = p.id
left join ever_regular er on er.participant_id = p.id
left join home_site hs on hs.participant_id = p.id
left join lateral (
  -- Friday meetings that took place at the participant's site since their last visit (any activity type)
  select count(*)::int as n from public.events e
  where e.type = 'friday' and e.site_id = hs.site_id and e.status not in ('draft', 'cancelled')
    and e.ends_at < now() and e.starts_at > a.last_attended_at
) missed on er.participant_id is not null
where p.anonymized_at is null;

-- Per event: registrations, attendance, new vs returning, show rate inputs and ratings.
create or replace view public.event_stats with (security_invoker = true) as
with first_att as (
  select r.participant_id, min(e.starts_at) as first_at
  from public.registrations r join public.events e on e.id = r.event_id
  where r.attendance = 'attended' group by r.participant_id
)
select
  e.id as event_id,
  count(r.id) filter (where r.status = 'registered' and not r.is_walk_in)::int as registered_count,
  count(r.id) filter (where r.status = 'waitlisted')::int as waitlisted_count,
  count(r.id) filter (where r.status = 'cancelled')::int as cancelled_count,
  count(r.id) filter (where r.attendance = 'attended')::int as attended_count,
  count(r.id) filter (where r.attendance = 'attended' and r.is_walk_in)::int as walk_in_count,
  count(r.id) filter (where r.attendance = 'no_show')::int as no_show_count,
  count(r.id) filter (where r.attendance = 'attended' and r.status = 'registered' and not r.is_walk_in)::int as attended_registered_count,
  count(r.id) filter (where r.attendance = 'attended' and fa.first_at >= e.starts_at)::int as new_count,
  count(r.id) filter (where r.attendance = 'attended' and fa.first_at < e.starts_at)::int as returning_count,
  count(r.id) filter (where r.attendance = 'attended' and r.checkin_method = 'self_qr')::int as self_checkin_count,
  coalesce(max(fb.feedback_count), 0)::int as feedback_count,
  max(fb.avg_overall) as avg_overall,
  max(fb.avg_activity) as avg_activity,
  max(fb.avg_lecture) as avg_lecture
from public.events e
left join public.registrations r on r.event_id = e.id
left join first_att fa on fa.participant_id = r.participant_id
left join lateral (
  select count(*) as feedback_count, round(avg(f.overall_rating), 2) as avg_overall,
         round(avg(f.activity_rating), 2) as avg_activity, round(avg(f.lecture_rating), 2) as avg_lecture
  from public.feedback f where f.event_id = e.id
) fb on true
group by e.id;

grant select on public.participant_stats, public.event_stats to authenticated;

-- ───────────── report functions (all: admin + coordinator) ─────────────

-- Past, held events in the period (filters: type, site).
create or replace function private.period_events(p_from date, p_to date, p_type text, p_site uuid)
returns setof public.events language sql stable set search_path = '' as $$
  select e.* from public.events e
  where e.status not in ('draft', 'cancelled') and e.starts_at < now()
    and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
    and private.in_period(e.starts_at, p_from, p_to)
$$;
grant execute on function private.period_events(date, date, text, uuid) to authenticated;

create or replace function public.report_kpis(p_from date default null, p_to date default null, p_type text default null, p_site uuid default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_s public.settings;
  v_out jsonb;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_s from public.settings;
  with ev as (select id, starts_at from private.period_events(p_from, p_to, p_type, p_site)),
  regs as (select r.* from public.registrations r join ev on ev.id = r.event_id),
  att as (select distinct participant_id from regs where attendance = 'attended'),
  first_any as (
    select r.participant_id, min(e.starts_at) as first_at
    from public.registrations r join public.events e on e.id = r.event_id
    where r.attendance = 'attended' group by r.participant_id),
  cnt as (
    select r.participant_id, count(*) as n
    from public.registrations r join public.events e on e.id = r.event_id
    where r.attendance = 'attended' and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
      and (p_to is null or (e.starts_at at time zone 'Asia/Jerusalem')::date <= p_to)
    group by r.participant_id),
  newp as (select a.participant_id from att a join first_any f using (participant_id) where private.in_period(f.first_at, p_from, p_to)),
  friendp as (
    select n.participant_id from newp n
    join public.participants p on p.id = n.participant_id
    left join public.acquisition_sources s on s.id = p.first_source_id
    where coalesce(s.is_friend, false) or p.referred_by_participant_id is not null),
  fb as (select f.overall_rating from public.feedback f join ev on ev.id = f.event_id)
  select jsonb_build_object(
    'events', (select count(*) from ev),
    'attendances', (select count(*) from regs where attendance = 'attended'),
    'unique_attendees', (select count(*) from att),
    'preregistered', (select count(*) from regs where status = 'registered' and not is_walk_in),
    'preregistered_attended', (select count(*) from regs where status = 'registered' and not is_walk_in and attendance = 'attended'),
    'walk_ins', (select count(*) from regs where attendance = 'attended' and is_walk_in),
    'cancelled', (select count(*) from regs where status = 'cancelled'),
    'new_attendees', (select count(*) from newp),
    'returning_attendees', (select count(*) from att a join cnt c using (participant_id) where c.n >= 2),
    'friend_new', (select count(*) from friendp),
    'feedback_count', (select count(*) from fb),
    'avg_rating', (select round(avg(overall_rating), 2) from fb),
    'self_checkins', (select count(*) from regs where attendance = 'attended' and checkin_method = 'self_qr'),
    'goals', jsonb_build_object(
      'avg_attendance', v_s.goal_avg_attendance, 'show_rate', v_s.goal_show_rate, 'return_rate', v_s.goal_return_rate,
      'friend_share', v_s.goal_friend_share, 'avg_rating', v_s.goal_avg_rating))
  into v_out;
  return v_out;
end $$;

-- One row per event (past and upcoming) with its stats. Used by the events report and the trend chart.
create or replace function public.report_events(p_from date default null, p_to date default null, p_type text default null,
                                                p_site uuid default null, p_past_only boolean default true)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'type', e.type, 'status', e.status, 'starts_at', e.starts_at, 'capacity', e.capacity,
      'site_name', si.name, 'lecture_topic', e.lecture_topic, 'activity_name', e.activity_name,
      'speaker_name', sp.full_name, 'instructor_name', ins.full_name) || to_jsonb(st) - 'event_id'
      order by e.starts_at)
    from public.events e
    join public.sites si on si.id = e.site_id
    left join public.speakers sp on sp.id = e.speaker_id
    left join public.speakers ins on ins.id = e.instructor_id
    join public.event_stats st on st.event_id = e.id
    where e.status not in ('draft', 'cancelled')
      and (not p_past_only or e.starts_at < now())
      and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
      and private.in_period(e.starts_at, p_from, p_to)), '[]'::jsonb);
end $$;

create or replace function public.report_monthly(p_from date default null, p_to date default null, p_type text default null, p_site uuid default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with ev as (select id, starts_at, date_trunc('month', starts_at at time zone 'Asia/Jerusalem')::date as month
                from private.period_events(p_from, p_to, p_type, p_site)),
    first_any as (
      select r.participant_id, date_trunc('month', min(e.starts_at) at time zone 'Asia/Jerusalem')::date as first_month
      from public.registrations r join public.events e on e.id = r.event_id
      where r.attendance = 'attended' group by r.participant_id),
    m as (
      select ev.month,
             count(distinct ev.id) as events,
             count(r.id) filter (where r.attendance = 'attended') as attendances,
             count(distinct r.participant_id) filter (where r.attendance = 'attended') as unique_attendees,
             count(distinct r.participant_id) filter (where r.attendance = 'attended' and f.first_month = ev.month) as new_attendees,
             count(r.id) filter (where r.status = 'registered' and not r.is_walk_in) as preregistered,
             count(r.id) filter (where r.status = 'registered' and not r.is_walk_in and r.attendance = 'attended') as preregistered_attended
      from ev
      left join public.registrations r on r.event_id = ev.id
      left join first_any f on f.participant_id = r.participant_id
      group by ev.month),
    rt as (
      select ev.month, round(avg(f.overall_rating), 2) as avg_rating, count(f.id) as feedback_count
      from ev join public.feedback f on f.event_id = ev.id group by ev.month)
    select jsonb_agg(to_jsonb(m) || jsonb_build_object('avg_rating', rt.avg_rating, 'feedback_count', coalesce(rt.feedback_count, 0))
                     order by m.month)
    from m left join rt using (month)), '[]'::jsonb);
end $$;

-- Sources (מקור היכרות): of the people who first came in the period through each source, how many came back.
create or replace function public.report_sources(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with first_any as (
      select r.participant_id, min(e.starts_at) as first_at, count(*) as attended
      from public.registrations r join public.events e on e.id = r.event_id
      where r.attendance = 'attended' group by r.participant_id),
    cohort as (select * from first_any where private.in_period(first_at, p_from, p_to)),
    came as (
      select p.first_source_id as source_id, count(*) as participants,
             count(*) filter (where c.attended >= 2) as returned,
             round(avg(c.attended), 2) as avg_attended,
             count(*) filter (where p.referred_by_participant_id is not null) as with_referrer
      from cohort c join public.participants p on p.id = c.participant_id
      group by p.first_source_id),
    never as (
      select p.first_source_id as source_id, count(*) as registered_only
      from public.participants p
      where p.anonymized_at is null and private.in_period(p.created_at, p_from, p_to)
        and not exists (select 1 from first_any f where f.participant_id = p.id)
      group by p.first_source_id)
    select jsonb_agg(jsonb_build_object(
      'source_id', k.source_id, 'label', coalesce(s.label, 'לא ידוע'), 'is_friend', coalesce(s.is_friend, false),
      'participants', coalesce(came.participants, 0), 'returned', coalesce(came.returned, 0),
      'avg_attended', came.avg_attended, 'with_referrer', coalesce(came.with_referrer, 0),
      'registered_only', coalesce(never.registered_only, 0))
      order by coalesce(came.participants, 0) desc, coalesce(never.registered_only, 0) desc)
    from (select source_id from came union select source_id from never) k
    left join came on came.source_id is not distinct from k.source_id
    left join never on never.source_id is not distinct from k.source_id
    left join public.acquisition_sources s on s.id = k.source_id), '[]'::jsonb);
end $$;

-- Registration links per channel/campaign (?ref=code).
create or replace function public.report_links(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with first_reg as (
      select distinct on (participant_id) participant_id, id from public.registrations order by participant_id, registered_at)
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'code', l.code, 'label', l.label, 'source_label', s.label, 'campaign', l.campaign, 'is_active', l.is_active,
      'registrations', x.registrations, 'attended', x.attended, 'new_people', x.new_people) order by x.registrations desc, l.label)
    from public.referral_links l
    left join public.acquisition_sources s on s.id = l.source_id
    cross join lateral (
      select count(r.id) as registrations,
             count(r.id) filter (where r.attendance = 'attended') as attended,
             count(r.id) filter (where fr.id is not null) as new_people
      from public.registrations r left join first_reg fr on fr.id = r.id
      where r.referral_link_id = l.id and private.in_period(r.registered_at, p_from, p_to)) x), '[]'::jsonb);
end $$;

-- Who brought whom: participants ranked by friends they referred (in the period).
create or replace function public.report_referrers(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return jsonb_build_object(
    'referrers', coalesce((
      select jsonb_agg(x order by x.friends desc, x.friends_attended desc) from (
        select ref.id, ref.full_name, count(p.id) as friends,
               count(p.id) filter (where coalesce(ps.attended_count, 0) >= 1) as friends_attended,
               count(p.id) filter (where coalesce(ps.attended_count, 0) >= 2) as friends_returned
        from public.participants p
        join public.participants ref on ref.id = p.referred_by_participant_id
        left join public.participant_stats ps on ps.participant_id = p.id
        where private.in_period(p.created_at, p_from, p_to) and ref.anonymized_at is null
        group by ref.id, ref.full_name
        order by count(p.id) desc limit 30) x), '[]'::jsonb),
    'unlinked_names', (
      select count(*) from public.participants p
      where p.referred_by_participant_id is null and p.referred_by_name is not null and p.anonymized_at is null
        and private.in_period(p.created_at, p_from, p_to)));
end $$;

-- Speakers and instructors: how many came to their meetings and how they were rated (questionnaire Q32).
create or replace function public.report_presenters(p_from date default null, p_to date default null, p_site uuid default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with ev as (select * from private.period_events(p_from, p_to, null, p_site))
    select jsonb_agg(x order by x.avg_attendance desc nulls last) from (
      select sp.id, sp.full_name, sp.kind, sp.topic,
             count(distinct ev.id) as events,
             round(avg(st.attended_count), 1) as avg_attendance,
             sum(st.new_count) as new_attendees,
             round(avg(case when sp.kind = 'speaker' then st.avg_lecture else st.avg_activity end), 2) as avg_rating,
             string_agg(distinct ev.lecture_topic, ' · ') as topics
      from public.speakers sp
      join ev on ev.speaker_id = sp.id or ev.instructor_id = sp.id
      join public.event_stats st on st.event_id = ev.id
      group by sp.id) x), '[]'::jsonb);
end $$;

-- How many meetings each participant came to (retention shape).
create or replace function public.report_distribution(p_type text default null, p_site uuid default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'participants', coalesce(c.n, 0)) order by b.ord)
    from (values (1, '1'), (2, '2'), (3, '3–5'), (4, '6–10'), (5, '11+')) b(ord, bucket)
    left join (
      select case when n = 1 then '1' when n = 2 then '2' when n <= 5 then '3–5' when n <= 10 then '6–10' else '11+' end as bucket,
             count(*) as n
      from (
        select r.participant_id, count(*) as n
        from public.registrations r join public.events e on e.id = r.event_id
        where r.attendance = 'attended' and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
        group by r.participant_id) per
      group by 1) c on c.bucket = b.bucket), '[]'::jsonb);
end $$;

-- The people behind a KPI number (click-through from the dashboard).
create or replace function public.report_drilldown(p_kind text, p_from date default null, p_to date default null,
                                                   p_type text default null, p_site uuid default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  if p_kind not in ('attendees', 'new', 'returning', 'friend_new') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  return coalesce((
    with ev as (select id from private.period_events(p_from, p_to, p_type, p_site)),
    att as (select distinct r.participant_id from public.registrations r join ev on ev.id = r.event_id where r.attendance = 'attended'),
    cnt as (
      select r.participant_id, count(*) as n
      from public.registrations r join public.events e on e.id = r.event_id
      where r.attendance = 'attended' and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
        and (p_to is null or (e.starts_at at time zone 'Asia/Jerusalem')::date <= p_to)
      group by r.participant_id)
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'city', p.city, 'source_label', s.label,
      'attended_count', ps.attended_count, 'first_attended_at', ps.first_attended_at, 'last_attended_at', ps.last_attended_at,
      'engagement_status', ps.engagement_status) order by p.full_name)
    from att a
    join public.participants p on p.id = a.participant_id
    join public.participant_stats ps on ps.participant_id = p.id
    left join public.acquisition_sources s on s.id = p.first_source_id
    left join cnt c on c.participant_id = p.id
    where p.anonymized_at is null and case p_kind
      when 'attendees' then true
      when 'returning' then coalesce(c.n, 0) >= 2
      when 'new' then private.in_period(ps.first_attended_at, p_from, p_to)
      when 'friend_new' then private.in_period(ps.first_attended_at, p_from, p_to)
                             and (coalesce(s.is_friend, false) or p.referred_by_participant_id is not null)
    end), '[]'::jsonb);
end $$;

-- "Needs attention" list on the dashboard.
create or replace function public.attention_items()
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform private.assert_role('admin', 'coordinator');
  return jsonb_build_object(
    'lapsed', coalesce((
      select jsonb_agg(jsonb_build_object('participant_id', p.id, 'full_name', p.full_name, 'last_attended_at', ps.last_attended_at,
                                          'friday_count', ps.friday_count, 'fridays_missed', ps.fridays_missed,
                                          'has_open_task', exists (select 1 from public.follow_ups f where f.participant_id = p.id and f.status = 'open'))
                       order by ps.last_attended_at desc)
      from public.participant_stats ps join public.participants p on p.id = ps.participant_id
      where ps.engagement_status = 'lapsed'), '[]'::jsonb),
    'followups_open', (select count(*) from public.follow_ups where status = 'open'),
    'followups_overdue', (select count(*) from public.follow_ups where status = 'open' and due_date < private.local_today()),
    'followups_mine', (select count(*) from public.follow_ups where status = 'open' and assignee_id = v_uid),
    'events_unclosed', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
      from public.events e where e.status in ('open', 'closed') and e.ends_at < now()), '[]'::jsonb),
    'fridays_without_speaker', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
      from public.events e left join public.speakers sp on sp.id = e.speaker_id
      where e.type = 'friday' and e.status not in ('cancelled', 'completed') and e.starts_at > now()
        and e.starts_at < now() + interval '35 days'
        and (e.speaker_id is null or sp.status <> 'approved')), '[]'::jsonb),
    'waitlist_with_space', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
                                          'waitlisted', st.waitlisted_count, 'free', e.capacity - st.registered_count))
      from public.events e join public.event_stats st on st.event_id = e.id
      where e.status = 'open' and e.starts_at > now() and st.waitlisted_count > 0
        and (e.capacity is null or st.registered_count < e.capacity)), '[]'::jsonb),
    'drafts_soon', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
      from public.events e where e.status = 'draft' and e.starts_at > now() and e.starts_at < now() + interval '8 days'), '[]'::jsonb),
    'proposals_pending', (select count(*) from public.speakers where status = 'proposed'));
end $$;

grant execute on function public.report_kpis(date, date, text, uuid) to authenticated;
grant execute on function public.report_events(date, date, text, uuid, boolean) to authenticated;
grant execute on function public.report_monthly(date, date, text, uuid) to authenticated;
grant execute on function public.report_sources(date, date) to authenticated;
grant execute on function public.report_links(date, date) to authenticated;
grant execute on function public.report_referrers(date, date) to authenticated;
grant execute on function public.report_presenters(date, date, uuid) to authenticated;
grant execute on function public.report_distribution(text, uuid) to authenticated;
grant execute on function public.report_drilldown(text, date, date, text, uuid) to authenticated;
grant execute on function public.attention_items() to authenticated;
