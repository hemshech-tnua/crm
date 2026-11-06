-- Fixes from user-simulation round 1 (staff side). See docs/07-qa-report.md (S2, S3, S4, S7, S8, S14).

-- S2: goal metrics count only meetings that were closed (attendance final). An ended meeting that was not
-- closed would otherwise count as held with nobody present. The number of such meetings is reported separately.
create or replace function private.period_events(p_from date, p_to date, p_type text, p_site uuid)
returns setof public.events language sql stable set search_path = '' as $$
  select e.* from public.events e
  where e.status = 'completed'
    and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
    and private.in_period(e.starts_at, p_from, p_to)
$$;

do $$
declare
  src text;
begin
  select pg_get_functiondef('public.report_kpis(date, date, text, uuid)'::regprocedure) into src;
  src := replace(src, '''events'', (select count(*) from ev),',
    '''events'', (select count(*) from ev),
    ''unclosed_events'', (select count(*) from public.events e where e.status in (''open'', ''closed'') and e.ends_at < now()
                          and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
                          and private.in_period(e.starts_at, p_from, p_to)),');
  execute src;
end $$;

-- S4: closing a meeting does not open a second call task for someone who already has an open one.
do $$
declare
  src text;
begin
  select pg_get_functiondef('public.staff_complete_event(uuid)'::regprocedure) into src;
  src := replace(src,
    'where r.event_id = p_event_id and r.status = ''registered'' and r.attendance = ''no_show'' and pa.anonymized_at is null',
    'where r.event_id = p_event_id and r.status = ''registered'' and r.attendance = ''no_show'' and pa.anonymized_at is null
      and not exists (select 1 from public.follow_ups o where o.participant_id = r.participant_id and o.status = ''open'')');
  src := replace(src,
    'where r.event_id = p_event_id and r.attendance = ''attended'' and pa.anonymized_at is null',
    'where r.event_id = p_event_id and r.attendance = ''attended'' and pa.anonymized_at is null
      and not exists (select 1 from public.follow_ups o where o.participant_id = r.participant_id and o.status = ''open'')');
  src := replace(src,
    'where ps.engagement_status = ''lapsed''',
    'where ps.engagement_status = ''lapsed''
      and not exists (select 1 from public.follow_ups o where o.participant_id = ps.participant_id and o.status = ''open'')');
  execute src;
end $$;

-- S3: at the door, a walk-in typed by name is matched to an existing person instead of creating a duplicate.
-- The door team sees only first+last name and the last 4 phone digits of people whose name matches what they typed.
create or replace function public.staff_walkin_suggest(p_event_id uuid, p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
  v_q text := private.clean_text(p_query, 80);
begin
  select * into v_event from public.events where id = p_event_id;
  perform private.assert_door_access(v_event);
  if v_q is null or char_length(v_q) < 3 then
    return '[]'::jsonb;
  end if;
  perform set_config('pg_trgm.similarity_threshold', '0.4', true);
  return coalesce((
    select jsonb_agg(jsonb_build_object('participant_id', p.id, 'full_name', p.full_name, 'phone_last4', right(p.phone, 4), 'city', p.city)
                     order by extensions.similarity(p.full_name, v_q) desc)
    from (
      select * from public.participants p
      where p.anonymized_at is null and (p.full_name operator(extensions.%) v_q or p.full_name ilike v_q || '%')
        and not exists (select 1 from public.registrations r where r.event_id = p_event_id and r.participant_id = p.id and r.attendance = 'attended')
      order by extensions.similarity(p.full_name, v_q) desc
      limit 5) p), '[]'::jsonb);
end $$;

create or replace function public.staff_checkin_existing(p_event_id uuid, p_participant_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg public.registrations;
begin
  select * into v_event from public.events where id = p_event_id for update;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.participants where id = p_participant_id and anonymized_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = p_participant_id for update;
  if found then
    update public.registrations set status = 'registered', attendance = 'attended',
           checked_in_at = coalesce(checked_in_at, now()), checkin_method = coalesce(checkin_method, 'staff'),
           checked_in_by = coalesce(checked_in_by, (select auth.uid()))
    where id = v_reg.id;
  else
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, checked_in_by, created_via)
    values (p_event_id, p_participant_id, 'registered', 'attended', true, now(), 'staff', (select auth.uid()), 'walk_in_staff')
    returning * into v_reg;
  end if;
  return jsonb_build_object('registration_id', v_reg.id);
end $$;

grant execute on function public.staff_walkin_suggest(uuid, text) to authenticated;
grant execute on function public.staff_checkin_existing(uuid, uuid) to authenticated;

-- S7: speakers are rated on the lecture and instructors on the activity; "topics" means lecture topics for
-- speakers and activities (yoga/pilates) for instructors.
create or replace function public.report_presenters(p_from date default null, p_to date default null, p_site uuid default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with ev as (select * from private.period_events(p_from, p_to, null, p_site))
    select jsonb_agg(x order by x.kind desc, x.avg_attendance desc nulls last) from (
      select sp.id, sp.full_name, sp.kind, sp.topic,
             count(distinct ev.id) as events,
             round(avg(st.attended_count), 1) as avg_attendance,
             sum(st.new_count) as new_attendees,
             round(avg(case when sp.kind = 'speaker' then st.avg_lecture else st.avg_activity end), 2) as avg_rating,
             case when sp.kind = 'speaker' then string_agg(distinct ev.lecture_topic, ' · ')
                  else string_agg(distinct ev.activity_name, ' · ') end as topics
      from public.speakers sp
      join ev on (sp.kind = 'speaker' and ev.speaker_id = sp.id) or (sp.kind = 'instructor' and ev.instructor_id = sp.id)
      join public.event_stats st on st.event_id = ev.id
      group by sp.id) x), '[]'::jsonb);
end $$;

-- S14: who brought whom shows the names, not only counts.
create or replace function public.report_referrers(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return jsonb_build_object(
    'referrers', coalesce((
      select jsonb_agg(x order by x.friends desc, x.friends_attended desc) from (
        select ref.id, ref.full_name, count(p.id) as friends,
               count(p.id) filter (where coalesce(ps.attended_count, 0) >= 1) as friends_attended,
               count(p.id) filter (where coalesce(ps.attended_count, 0) >= 2) as friends_returned,
               jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'attended', coalesce(ps.attended_count, 0))
                         order by p.full_name) as friend_list
        from public.participants p
        join public.participants ref on ref.id = p.referred_by_participant_id
        left join public.participant_stats ps on ps.participant_id = p.id
        where private.in_period(p.created_at, p_from, p_to) and ref.anonymized_at is null and p.anonymized_at is null
        group by ref.id, ref.full_name
        order by count(p.id) desc limit 30) x), '[]'::jsonb),
    'unlinked_names', (
      select count(*) from public.participants p
      where p.referred_by_participant_id is null and p.referred_by_name is not null and p.anonymized_at is null
        and private.in_period(p.created_at, p_from, p_to)));
end $$;

-- S8 / S13: the reminder names the day instead of a fixed "tomorrow"; messages to participants use plural, not slashes.
update public.message_templates set body =
  'היי {שם_פרטי}, תזכורת: ב{תאריך} ב-{שעה} נפגשים ב{מקום}.' || E'\n' ||
  '{פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וזמן ביחד.' || E'\n' ||
  'אם לא מתאים לך להגיע, נשמח לעדכון כאן כדי שנפנה את המקום למי שמחכה.'
where key = 'reminder' and body like '%מחר, {תאריך}%';
