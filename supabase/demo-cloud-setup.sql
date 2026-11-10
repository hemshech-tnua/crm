-- DEMO PROJECT ONLY (hemshech-tnua-demo). Never run on production: it adds fictitious data and demo staff accounts.
-- Completes the hosted demo project after migrations 0100-0400: the remaining migrations, the fictitious demo data,
-- a meeting open for check-in, and three demo staff accounts (the password is stored only as a bcrypt hash).
-- It is fetched and run in one transaction by a short snippet in the Supabase SQL editor, which checks its sha256 first.
-- Generated from supabase/migrations/*.sql, demo-data.sql, demo-live.sql and seed.sql; do not edit by hand.
do $$ begin
  if exists (select 1 from public.participants) then
    raise exception 'This project already has participants. Demo setup refused.';
  end if;
end $$;

-- ===== migration 20261106000500_staff_api =====
-- Staff API: operations that span several rows or need minimal-data views for the door team.
-- Every function checks the caller's role itself (SECURITY DEFINER bypasses RLS by design).

-- The door team (volunteer) may work on an event only around its time; admin/coordinator always.
create or replace function private.assert_door_access(p_event public.events)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_event.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if private.has_role('admin', 'coordinator') then
    return;
  end if;
  if private.has_role('volunteer')
     and now() between p_event.starts_at - interval '12 hours' and p_event.ends_at + interval '12 hours' then
    return;
  end if;
  raise exception 'forbidden' using errcode = '42501';
end $$;

create or replace function private.assert_role(variadic p_roles text[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(variadic p_roles) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- Attendance list for the door. Volunteers get name, last 4 phone digits and flags only.
create or replace function public.staff_checkin_list(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
  v_full boolean;
begin
  select * into v_event from public.events where id = p_event_id;
  perform private.assert_door_access(v_event);
  v_full := private.has_role('admin', 'coordinator');
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.status_rank, x.display_name)
    from (
      select
        r.id as registration_id,
        case when v_full then pa.id end as participant_id,
        coalesce(pa.full_name, 'פרטים נמחקו') as display_name,
        right(pa.phone, 4) as phone_last4,
        case when v_full then pa.phone end as phone,
        r.status, r.attendance, r.is_walk_in, r.checked_in_at, r.checkin_method, r.registered_at,
        pa.photo_opt_out,
        prior.attended as prior_attended,
        prior.fridays as prior_fridays,
        prior.attended = 0 as first_time,
        case r.status when 'registered' then 0 when 'waitlisted' then 1 else 2 end as status_rank,
        case when r.status = 'waitlisted' then private.waitlist_position(r.id) end as waitlist_position
      from public.registrations r
      join public.participants pa on pa.id = r.participant_id
      cross join lateral (
        select count(*)::int as attended,
               count(*) filter (where e2.type = 'friday')::int as fridays
        from public.registrations r2 join public.events e2 on e2.id = r2.event_id
        where r2.participant_id = r.participant_id and r2.attendance = 'attended' and e2.starts_at < v_event.starts_at
      ) prior
      where r.event_id = p_event_id
    ) x), '[]'::jsonb);
end $$;

create or replace function public.staff_set_attendance(p_registration_id uuid, p_attendance text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
begin
  if p_attendance not in ('attended', 'no_show', 'unknown') then
    raise exception 'invalid_attendance' using errcode = 'P0001';
  end if;
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if p_attendance = 'attended' then
    update public.registrations set status = 'registered', attendance = 'attended',
           checked_in_at = coalesce(checked_in_at, now()), checkin_method = coalesce(checkin_method, 'staff'),
           checked_in_by = coalesce(checked_in_by, (select auth.uid()))
    where id = v_reg.id;
  else
    update public.registrations set attendance = p_attendance where id = v_reg.id;
  end if;
  return jsonb_build_object('registration_id', v_reg.id, 'attendance', p_attendance);
end $$;

create or replace function public.staff_cancel_registration(p_registration_id uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
begin
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  perform private.assert_door_access(v_event);
  update public.registrations set status = 'cancelled', attendance = 'unknown', cancelled_at = now(), cancelled_by = 'staff',
         cancel_reason = private.clean_text(p_reason, 300)
  where id = v_reg.id;
  return jsonb_build_object('registration_id', v_reg.id, 'status', 'cancelled');
end $$;

-- Someone arrived without registering. The door team types name + phone (other fields optional).
create or replace function public.staff_add_walkin(p_event_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  r private.person_input;
  v_pid uuid;
  v_is_new boolean;
  v_reg public.registrations;
  v_ref_id uuid;
  v_ref_name text;
  v_link_id uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  r := private.parse_person(p, false);
  perform set_config('app.trusted', 'on', true);
  perform set_config('app.consent_source', 'staff', true);
  select x.link_id, x.referrer_id, x.referrer_name into v_link_id, v_ref_id, v_ref_name
  from private.resolve_referrer(null, case when r.source_is_friend then r.referrer_text end, r.phone) x;
  select x.participant_id, x.is_new into v_pid, v_is_new
  from private.upsert_participant(r, 'checkin', v_ref_id, v_ref_name) x;

  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = v_pid for update;
  if found then
    update public.registrations set status = 'registered', attendance = 'attended',
           checked_in_at = coalesce(checked_in_at, now()), checkin_method = coalesce(checkin_method, 'staff'),
           checked_in_by = coalesce(checked_in_by, (select auth.uid()))
    where id = v_reg.id;
  else
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method,
                                      checked_in_by, how_heard_source_id, how_heard_detail, referrer_participant_id, referrer_name, created_via)
    values (p_event_id, v_pid, 'registered', 'attended', true, now(), 'staff', (select auth.uid()),
            r.source_id, r.source_detail, v_ref_id, v_ref_name, 'walk_in_staff')
    returning * into v_reg;
  end if;
  perform set_config('app.trusted', '', true);
  return jsonb_build_object('registration_id', v_reg.id, 'participant_is_new', v_is_new,
                            'already_registered', v_reg.created_via <> 'walk_in_staff' or not v_reg.is_walk_in);
end $$;

-- Register an existing participant from the office (phone call, WhatsApp).
create or replace function public.staff_register(p_event_id uuid, p_participant_id uuid, p_over_capacity boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg public.registrations;
  v_count int;
  v_status text;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_event.status in ('cancelled', 'completed') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.participants where id = p_participant_id and anonymized_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.registrations where event_id = p_event_id and status = 'registered';
  v_status := case when v_event.capacity is not null and v_count >= v_event.capacity and not p_over_capacity
                   then 'waitlisted' else 'registered' end;
  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = p_participant_id for update;
  if found then
    if v_reg.status <> 'cancelled' then
      raise exception 'already_registered' using errcode = 'P0001';
    end if;
    perform set_config('app.trusted', 'on', true);
    update public.registrations set status = v_status, registered_at = now(), attendance = 'unknown' where id = v_reg.id;
    perform set_config('app.trusted', '', true);
  else
    insert into public.registrations (event_id, participant_id, status, created_via)
    values (p_event_id, p_participant_id, v_status, 'staff')
    returning * into v_reg;
  end if;
  return jsonb_build_object('registration_id', v_reg.id, 'status', v_status);
end $$;

create or replace function public.staff_promote(p_registration_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found or v_reg.status <> 'waitlisted' then
    raise exception 'not_waitlisted' using errcode = 'P0001';
  end if;
  update public.registrations set status = 'registered', promoted_at = now() where id = v_reg.id;
  return jsonb_build_object('registration_id', v_reg.id, 'status', 'registered');
end $$;

-- After the meeting: whoever is still "unknown" did not come; follow-up tasks are created (questionnaire Q17, Q24).
create or replace function public.staff_complete_event(p_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  v_s public.settings;
  v_no_shows int;
  v_t1 int := 0;
  v_t2 int := 0;
  v_t3 int := 0;
  v_due date := private.local_today() + 3;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if now() < v_event.starts_at then
    raise exception 'not_started' using errcode = 'P0001';
  end if;
  select * into v_s from public.settings;

  update public.registrations set attendance = 'no_show'
  where event_id = p_event_id and status = 'registered' and attendance = 'unknown';
  get diagnostics v_no_shows = row_count;

  update public.events set status = 'completed' where id = p_event_id and status <> 'completed';

  if v_s.auto_task_no_show then
    insert into public.follow_ups (participant_id, event_id, type, title, due_date, assignee_id, created_by)
    select r.participant_id, p_event_id, 'no_show', 'נרשם/ה ולא הגיע/ה: הודעת "חסרת לנו" ושיחה', v_due, v_s.default_task_assignee, null
    from public.registrations r join public.participants pa on pa.id = r.participant_id
    where r.event_id = p_event_id and r.status = 'registered' and r.attendance = 'no_show' and pa.anonymized_at is null
    on conflict (participant_id, event_id, type) where event_id is not null do nothing;
    get diagnostics v_t1 = row_count;
  end if;

  if v_s.auto_task_first_time then
    insert into public.follow_ups (participant_id, event_id, type, title, due_date, assignee_id, created_by)
    select r.participant_id, p_event_id, 'first_time', 'הגיע/ה בפעם הראשונה: שיחת היכרות ותודה', v_due, v_s.default_task_assignee, null
    from public.registrations r join public.participants pa on pa.id = r.participant_id
    where r.event_id = p_event_id and r.attendance = 'attended' and pa.anonymized_at is null
      and not exists (
        select 1 from public.registrations r2 join public.events e2 on e2.id = r2.event_id
        where r2.participant_id = r.participant_id and r2.attendance = 'attended' and e2.starts_at < v_event.starts_at)
    on conflict (participant_id, event_id, type) where event_id is not null do nothing;
    get diagnostics v_t2 = row_count;
  end if;

  if v_s.auto_task_lapsed then
    insert into public.follow_ups (participant_id, type, title, due_date, assignee_id, created_by)
    select ps.participant_id, 'lapsed', 'קבוע/ה שהפסיק/ה להגיע: לשאול מה שלומו/ה', v_due, v_s.default_task_assignee, null
    from public.participant_stats ps
    where ps.engagement_status = 'lapsed'
      and not exists (
        select 1 from public.follow_ups f
        where f.participant_id = ps.participant_id and f.type = 'lapsed'
          and (f.status = 'open' or f.created_at > ps.last_attended_at))
    on conflict (participant_id) where type = 'lapsed' and status = 'open' do nothing;
    get diagnostics v_t3 = row_count;
  end if;

  return jsonb_build_object('no_shows', v_no_shows, 'tasks_no_show', v_t1, 'tasks_first_time', v_t2, 'tasks_lapsed', v_t3);
end $$;

-- Next week's Friday in one click. Speaker and topic are cleared (a new guest every week); everything else is copied.
create or replace function public.staff_duplicate_event(p_event_id uuid, p_starts_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_starts_at is null or p_starts_at < now() - interval '1 day' then
    raise exception 'invalid_date' using errcode = 'P0001';
  end if;
  insert into public.events (site_id, type, title, starts_at, ends_at, location, description, capacity, waitlist_enabled, status,
                             registration_closes_at, instructor_id, activity_name)
  select site_id, type, title, p_starts_at, p_starts_at + (ends_at - starts_at), location, description, capacity, waitlist_enabled, 'draft',
         case when registration_closes_at is not null then p_starts_at - (starts_at - registration_closes_at) end,
         instructor_id, activity_name
  from public.events where id = p_event_id
  returning id into v_id;
  if v_id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

-- Possible duplicates: same person with two phone numbers, similar names.
create or replace function public.staff_find_duplicates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'a', jsonb_build_object('id', a.id, 'full_name', a.full_name, 'phone', a.phone, 'city', a.city, 'created_at', a.created_at),
      'b', jsonb_build_object('id', b.id, 'full_name', b.full_name, 'phone', b.phone, 'city', b.city, 'created_at', b.created_at),
      'similarity', round(extensions.similarity(a.full_name, b.full_name)::numeric, 2)) order by extensions.similarity(a.full_name, b.full_name) desc)
    from public.participants a
    join public.participants b on a.id < b.id and a.full_name operator(extensions.%) b.full_name
    where a.anonymized_at is null and b.anonymized_at is null
    limit 100), '[]'::jsonb);
end $$;

-- Before creating a participant by hand: exact phone match and similar names.
create or replace function public.staff_check_duplicate(p_full_name text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_name text := private.clean_text(p_full_name, 80);
begin
  perform private.assert_role('admin', 'coordinator');
  perform set_config('pg_trgm.similarity_threshold', '0.5', true);
  return jsonb_build_object(
    'phone_valid', v_phone is not null,
    'by_phone', (select jsonb_build_object('id', id, 'full_name', full_name, 'city', city)
                 from public.participants where v_phone is not null and phone = v_phone),
    'similar', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name, 'city', city, 'phone_last4', right(phone, 4)))
      from (select * from public.participants
            where v_name is not null and anonymized_at is null and full_name operator(extensions.%) v_name
              and phone is distinct from v_phone
            order by extensions.similarity(full_name, v_name) desc limit 5) s), '[]'::jsonb));
end $$;

-- Merge two cards of the same person into one. History, feedback, tasks and contacts move to the kept card.
create or replace function public.staff_merge_participants(p_keep uuid, p_merge uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  k public.participants;
  m public.participants;
  rm record;
  v_keep_reg public.registrations;
  v_moved int := 0;
  v_rank_m int;
  v_rank_k int;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_keep = p_merge then
    raise exception 'same_participant' using errcode = 'P0001';
  end if;
  select * into k from public.participants where id = p_keep for update;
  select * into m from public.participants where id = p_merge for update;
  if k.id is null or m.id is null or k.anonymized_at is not null or m.anonymized_at is not null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform set_config('app.trusted', 'on', true);

  for rm in select * from public.registrations where participant_id = p_merge loop
    select * into v_keep_reg from public.registrations where participant_id = p_keep and event_id = rm.event_id for update;
    if v_keep_reg.id is null then
      update public.registrations set participant_id = p_keep,
             referrer_participant_id = nullif(referrer_participant_id, p_keep)
      where id = rm.id;
    else
      v_rank_m := case when rm.attendance = 'attended' then 4 when rm.status = 'registered' then 3 when rm.status = 'waitlisted' then 2 else 1 end;
      v_rank_k := case when v_keep_reg.attendance = 'attended' then 4 when v_keep_reg.status = 'registered' then 3 when v_keep_reg.status = 'waitlisted' then 2 else 1 end;
      if v_rank_m > v_rank_k then
        update public.registrations set status = rm.status, attendance = rm.attendance, checked_in_at = rm.checked_in_at,
               checkin_method = rm.checkin_method, checked_in_by = rm.checked_in_by,
               cancelled_at = rm.cancelled_at, cancelled_by = rm.cancelled_by
        where id = v_keep_reg.id;
      end if;
      update public.feedback set registration_id = v_keep_reg.id
      where registration_id = rm.id and not exists (select 1 from public.feedback f where f.registration_id = v_keep_reg.id);
      delete from public.registrations where id = rm.id;
    end if;
    v_keep_reg := null;
    v_moved := v_moved + 1;
  end loop;

  update public.feedback set participant_id = p_keep where participant_id = p_merge;
  delete from public.follow_ups f where f.participant_id = p_merge and (
    (f.event_id is not null and exists (select 1 from public.follow_ups g where g.participant_id = p_keep and g.event_id = f.event_id and g.type = f.type))
    or (f.type = 'lapsed' and f.status = 'open' and exists (select 1 from public.follow_ups g where g.participant_id = p_keep and g.type = 'lapsed' and g.status = 'open')));
  update public.follow_ups set participant_id = p_keep where participant_id = p_merge;
  update public.contact_log set participant_id = p_keep where participant_id = p_merge;
  update public.consents set participant_id = p_keep where participant_id = p_merge;
  update public.participants set referred_by_participant_id = case when id = p_keep then null else p_keep end
  where referred_by_participant_id = p_merge;
  update public.registrations set referrer_participant_id = case when participant_id = p_keep then null else p_keep end
  where referrer_participant_id = p_merge;

  update public.participants set
    city = coalesce(city, m.city),
    birth_year = coalesce(birth_year, m.birth_year),
    birth_date = coalesce(birth_date, m.birth_date),
    occupation = coalesce(occupation, m.occupation),
    first_source_id = coalesce(first_source_id, m.first_source_id),
    first_source_detail = coalesce(first_source_detail, m.first_source_detail),
    referred_by_participant_id = coalesce(referred_by_participant_id, nullif(m.referred_by_participant_id, p_keep)),
    referred_by_name = coalesce(referred_by_name, m.referred_by_name),
    photo_opt_out = photo_opt_out or m.photo_opt_out,
    notes = left(nullif(concat_ws(E'\n', notes, m.notes), ''), 1000)
  where id = p_keep;

  delete from public.participants where id = p_merge;
  perform set_config('app.trusted', '', true);
  perform private.audit_action('merge', 'participants', p_keep::text, jsonb_build_object('merged_id', p_merge, 'registrations', v_moved));
  return jsonb_build_object('kept', p_keep, 'registrations_moved', v_moved);
end $$;

-- Right to erasure: removes every personal detail, keeps anonymous statistics (attendance counts, ratings).
create or replace function public.admin_anonymize_participant(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.assert_role('admin');
  if not exists (select 1 from public.participants where id = p_id and anonymized_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.participants set full_name = null, phone = null, city = null, birth_year = null, birth_date = null,
         occupation = null, first_source_detail = null, referred_by_name = null, notes = null,
         consent_updates = false, photo_opt_out = false, anonymized_at = now()
  where id = p_id;
  update public.registrations set submitted_name = null, referrer_name = null, how_heard_detail = null,
         manage_token_hash = null, cancel_reason = null
  where participant_id = p_id;
  update public.feedback set comment = null where participant_id = p_id;
  delete from public.contact_log where participant_id = p_id;
  delete from public.follow_ups where participant_id = p_id;
  perform set_config('app.trusted', '', true);
  perform private.audit_action('anonymize', 'participants', p_id::text);
  return jsonb_build_object('anonymized', p_id);
end $$;

-- Retention policy: participants with no activity for retention_months are offered for anonymization (never automatic).
create or replace function public.admin_retention_candidates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_months int;
begin
  perform private.assert_role('admin');
  select retention_months into v_months from public.settings;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'city', p.city, 'last_activity', a.last_activity)
                     order by a.last_activity)
    from public.participants p
    cross join lateral (
      select greatest(p.created_at, max(r.registered_at), max(r.checked_in_at)) as last_activity
      from public.registrations r where r.participant_id = p.id
    ) a
    where p.anonymized_at is null and a.last_activity < now() - make_interval(months => v_months)), '[]'::jsonb);
end $$;

-- Staff profile for the signed-in user (also readable while on a temporary password).
create or replace function public.staff_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', s.user_id, 'full_name', s.full_name, 'email', s.email, 'role', s.role,
                            'is_active', s.is_active, 'must_change_password', s.must_change_password)
  from public.staff s where s.user_id = (select auth.uid())
$$;

grant execute on function public.staff_checkin_list(uuid) to authenticated;
grant execute on function public.staff_set_attendance(uuid, text) to authenticated;
grant execute on function public.staff_cancel_registration(uuid, text) to authenticated;
grant execute on function public.staff_add_walkin(uuid, jsonb) to authenticated;
grant execute on function public.staff_register(uuid, uuid, boolean) to authenticated;
grant execute on function public.staff_promote(uuid) to authenticated;
grant execute on function public.staff_complete_event(uuid) to authenticated;
grant execute on function public.staff_duplicate_event(uuid, timestamptz) to authenticated;
grant execute on function public.staff_find_duplicates() to authenticated;
grant execute on function public.staff_check_duplicate(text, text) to authenticated;
grant execute on function public.staff_merge_participants(uuid, uuid) to authenticated;
grant execute on function public.admin_anonymize_participant(uuid) to authenticated;
grant execute on function public.admin_retention_candidates() to authenticated;
grant execute on function public.staff_me() to authenticated;

-- ===== migration 20261106000600_reporting =====
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

-- ===== migration 20261106000700_reference_data =====
-- Reference data: the site, settings, acquisition sources and WhatsApp message templates.
-- These are production defaults taken from the questionnaire (not demo data); admins edit them in Settings.

grant execute on function private.assert_role(text[]) to authenticated;
grant execute on function private.local_today() to authenticated;

insert into public.sites (id, name, address)
values ('00000000-0000-4000-8000-000000000001', 'הולמס פלייס מודיעין', 'הולמס פלייס, מודיעין');

insert into public.settings (id, default_site_id, default_capacity)
values (true, '00000000-0000-4000-8000-000000000001', 40);

insert into public.acquisition_sources (key, label, is_friend, asks_detail, sort_order) values
  ('instagram',         'אינסטגרם',                          false, false, 10),
  ('whatsapp_group',    'קבוצת וואטסאפ',                     false, false, 20),
  ('friend',            'חבר/ה סיפר/ה לי או הביא/ה אותי',     true,  false, 30),
  ('facebook',          'פייסבוק',                           false, false, 40),
  ('organization',      'ארגון או גורם מקצועי',              false, true,  50),
  ('previous_activity', 'כבר הייתי בפעילות של העמותה',        false, false, 60),
  ('other',             'אחר',                               false, true,  90);

-- Placeholders: {שם_פרטי} {שם_המפגש} {תאריך} {שעה} {מקום} {פעילות} {מרצה} {נושא} {קישור_הרשמה} {קישור_משוב}
insert into public.message_templates (key, label, audience, is_marketing, sort_order, body) values
  ('confirmation', 'אישור הרשמה', 'registered', false, 10,
   'היי {שם_פרטי}, ההרשמה ל{שם_המפגש} ב{תאריך} בשעה {שעה} נקלטה. נפגשים ב{מקום}. מחכים לך!' || E'\n' ||
   'אם משהו משתנה, אפשר לענות להודעה הזו.'),
  ('reminder', 'תזכורת (יום חמישי)', 'registered', false, 20,
   'היי {שם_פרטי}, תזכורת: מחר, {תאריך}, ב-{שעה} נפגשים ב{מקום}.' || E'\n' ||
   '{פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וזמן ביחד.' || E'\n' ||
   'אם לא מתאים לך להגיע, נשמח שתעדכן/י כאן כדי שנפנה את המקום למי שמחכה.'),
  ('thanks', 'תודה + משוב אחרי המפגש', 'attended', false, 30,
   '{שם_פרטי}, תודה שהיית איתנו ב{שם_המפגש}! נשמח לשמוע איך היה, זה לוקח דקה: {קישור_משוב}'),
  ('missed_you', 'חסרת לנו', 'no_show', false, 40,
   'היי {שם_פרטי}, חסרת לנו ב{שם_המפגש} ב{תאריך}. הכול בסדר? נשמח לראות אותך בפעם הבאה.'),
  ('waitlist_promoted', 'התפנה מקום', 'waitlisted', false, 50,
   'היי {שם_פרטי}, התפנה מקום ב{שם_המפגש} ב{תאריך}, ואת/ה רשום/ה! מחכים לך ב-{שעה} ב{מקום}.'),
  ('invite_next', 'הזמנה למפגש הבא', 'consented', true, 60,
   'היי {שם_פרטי}! ב{תאריך} נפגשים שוב: {פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וחברים.' || E'\n' ||
   'להרשמה: {קישור_הרשמה}'),
  ('lapsed', 'מזמן לא התראינו', 'participant', true, 70,
   'היי {שם_פרטי}, מזמן לא ראינו אותך במפגשים ורצינו לשאול מה שלומך. נשמח לראות אותך: {קישור_הרשמה}');

-- ===== migration 20261106000800_review_fixes =====
-- Fixes from the integration review.

-- 1) "Not the same person": dismissed duplicate pairs stop coming back (common names repeat a lot).
create table public.duplicate_dismissals (
  a uuid not null references public.participants(id) on delete cascade,
  b uuid not null references public.participants(id) on delete cascade,
  dismissed_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table public.duplicate_dismissals enable row level security;
revoke all on public.duplicate_dismissals from anon, authenticated;

create or replace function public.staff_dismiss_duplicate(p_a uuid, p_b uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  if p_a = p_b then
    raise exception 'same_participant' using errcode = 'P0001';
  end if;
  insert into public.duplicate_dismissals (a, b) values (least(p_a, p_b), greatest(p_a, p_b)) on conflict do nothing;
end $$;
grant execute on function public.staff_dismiss_duplicate(uuid, uuid) to authenticated;

create or replace function public.staff_find_duplicates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);
  return coalesce((
    select jsonb_agg(x.pair order by x.sim desc, x.newest desc)
    from (
      select jsonb_build_object(
        'a', jsonb_build_object('id', a.id, 'full_name', a.full_name, 'phone', a.phone, 'city', a.city, 'created_at', a.created_at),
        'b', jsonb_build_object('id', b.id, 'full_name', b.full_name, 'phone', b.phone, 'city', b.city, 'created_at', b.created_at),
        'similarity', round(extensions.similarity(a.full_name, b.full_name)::numeric, 2)) as pair,
        extensions.similarity(a.full_name, b.full_name) as sim,
        greatest(a.created_at, b.created_at) as newest
      from public.participants a
      join public.participants b on a.id < b.id and a.full_name operator(extensions.%) b.full_name
      where a.anonymized_at is null and b.anonymized_at is null
        and not exists (select 1 from public.duplicate_dismissals d where d.a = a.id and d.b = b.id)
      -- the newest pairs first among equally similar names: those are the ones still waiting for a decision
      order by sim desc, newest desc
      limit 200) x), '[]'::jsonb);
end $$;

-- 2) Speaker phones are normalized like participant phones (a local 050-… number no longer fails the format check).
create or replace function private.speakers_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phone is not null then
    new.phone := coalesce(private.normalize_phone(new.phone), new.phone);
  end if;
  new.full_name := private.clean_text(new.full_name, 80);
  return new;
end $$;
create trigger speakers_normalize before insert or update of phone, full_name on public.speakers
  for each row execute function private.speakers_normalize();

-- 3) Promoting from the waitlist respects the event's state and capacity (an explicit override is still possible).
drop function if exists public.staff_promote(uuid);
create or replace function public.staff_promote(p_registration_id uuid, p_over_capacity boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_count int;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found or v_reg.status <> 'waitlisted' then
    raise exception 'not_waitlisted' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id for update;
  if v_event.status in ('cancelled', 'completed', 'draft') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is not null and v_count >= v_event.capacity and not p_over_capacity then
    raise exception 'event_full' using errcode = 'P0001';
  end if;
  update public.registrations set status = 'registered', promoted_at = now() where id = v_reg.id;
  return jsonb_build_object('registration_id', v_reg.id, 'status', 'registered');
end $$;
grant execute on function public.staff_promote(uuid, boolean) to authenticated;

-- ===== migration 20261106001000_simulation_fixes =====
-- Fixes from user-simulation round 1 (participant side). See docs/07-qa-report.md (U1, U3, U6, U7, U8, U11).

-- U3/U7: a public contact for the team (cancelling without the link, privacy requests).
alter table public.settings add column contact_phone text
  check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$');

create or replace function private.settings_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contact_phone is not null then
    new.contact_phone := coalesce(private.normalize_phone(new.contact_phone), new.contact_phone);
  end if;
  return new;
end $$;
create trigger settings_normalize before insert or update of contact_phone on public.settings
  for each row execute function private.settings_normalize();

create or replace function public.public_org_info()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('org_name', org_name, 'contact_phone', contact_phone) from public.settings
$$;
grant execute on function public.public_org_info() to anon, authenticated;

-- U1: a public answer never shows the name stored for a phone; it shows the name typed in that registration.
create or replace function private.registrant_first_name(p_reg public.registrations)
returns text language sql stable security definer set search_path = '' as $$
  select private.first_name(coalesce(p_reg.submitted_name, (select full_name from public.participants where id = p_reg.participant_id)))
$$;

create or replace function private.checkin_result(p_reg_id uuid, p_result text, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'result', p_result,
    'first_name', private.registrant_first_name(r),
    'token', p_token,
    'photo_opt_out', pa.photo_opt_out,
    'invite_code', pa.referral_code,
    'attended_count', (select count(*) from public.registrations x where x.participant_id = pa.id and x.attendance = 'attended'),
    'friday_count', (select count(*) from public.registrations x join public.events e on e.id = x.event_id
                     where x.participant_id = pa.id and x.attendance = 'attended' and e.type = 'friday'),
    'can_undo', r.checkin_method = 'self_qr' and r.checked_in_at > now() - interval '10 minutes',
    'event', private.event_public(r.event_id))
  from public.registrations r join public.participants pa on pa.id = r.participant_id
  where r.id = p_reg_id
$$;

-- U8: after arriving, the personal page no longer offers to cancel.
create or replace function public.public_registration(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_code text;
  v_fb public.feedback;
  v_days int;
begin
  v_reg := private.registration_by_token(p_token);
  if v_reg.id is null then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  select referral_code into v_code from public.participants where id = v_reg.participant_id;
  select * into v_fb from public.feedback where registration_id = v_reg.id;
  select feedback_days into v_days from public.settings;
  return jsonb_build_object(
    'status', v_reg.status,
    'attendance', v_reg.attendance,
    'first_name', private.registrant_first_name(v_reg),
    'invite_code', v_code,
    'waitlist_position', case when v_reg.status = 'waitlisted' then private.waitlist_position(v_reg.id) end,
    'can_cancel', v_reg.status <> 'cancelled' and v_reg.attendance <> 'attended' and now() < v_event.starts_at
                  and v_event.status not in ('cancelled', 'completed'),
    'feedback_open', now() >= v_event.starts_at and now() <= v_event.ends_at + make_interval(days => v_days) and v_event.status <> 'cancelled',
    'feedback_given', v_fb.id is not null,
    'event', private.event_public(v_event.id));
end $$;

create or replace function public.public_cancel(p_token text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
begin
  perform private.rate_limit('cancel-ip:' || private.client_key(), 20, 3600);
  v_reg := private.registration_by_token(p_token);
  if v_reg.id is null then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  if now() >= v_event.starts_at or v_event.status in ('cancelled', 'completed') or v_reg.attendance = 'attended' then
    raise exception 'too_late' using errcode = 'P0001';
  end if;
  if v_reg.status <> 'cancelled' then
    update public.registrations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'participant',
           cancel_reason = private.clean_text(p_reason, 300)
    where id = v_reg.id;
  end if;
  return jsonb_build_object('status', 'cancelled');
end $$;

-- U6: "that's not me": a self check-in can be undone from the same screen for 10 minutes (e.g. a mistyped number).
create or replace function public.public_checkin_undo(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
begin
  perform private.rate_limit('undo-ip:' || private.client_key(), 20, 600);
  v_reg := private.registration_by_token(p_token);
  if v_reg.id is null then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  if v_reg.attendance <> 'attended' or v_reg.checkin_method is distinct from 'self_qr' or v_reg.checked_in_at < now() - interval '10 minutes' then
    raise exception 'too_late' using errcode = 'P0001';
  end if;
  perform set_config('app.trusted', 'on', true);
  if v_reg.is_walk_in and v_reg.created_via = 'checkin' and v_reg.created_at > now() - interval '10 minutes' then
    -- the registration only existed because of this check-in
    delete from public.registrations where id = v_reg.id;
  else
    update public.registrations set attendance = 'unknown', manage_token_hash = null where id = v_reg.id;
  end if;
  perform set_config('app.trusted', '', true);
  perform private.audit_action('checkin_undo', 'registrations', v_reg.id::text);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.public_checkin_undo(text) to anon, authenticated;

-- U1: walk-ins of a known phone keep the name typed at the door, for staff review.
create or replace function private.note_submitted_name(p_reg_id uuid, p_typed text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.registrations r set submitted_name = p_typed
  from public.participants p
  where r.id = p_reg_id and p.id = r.participant_id and p_typed is not null
    and lower(btrim(p_typed)) <> lower(btrim(coalesce(p.full_name, '')));
end $$;

do $$
declare
  src text;
begin
  -- public_walkin: after the registration row exists, keep the typed name if it differs from the card
  select pg_get_functiondef('public.public_walkin(jsonb)'::regprocedure) into src;
  src := replace(src,
    'v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);',
    'perform private.note_submitted_name(v_reg.id, r.full_name);
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);');
  execute src;
end $$;

-- U11: arriving through a channel link (e.g. ?ref=ig-bio) preselects that source in the form.
create or replace function public.public_get_event(p_code text, p_ref text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v_out jsonb;
  v_ref_name text;
  v_src text;
begin
  select id into v_id from public.events where public_code = lower(btrim(coalesce(p_code, ''))) and status <> 'draft';
  if not found then
    -- U9: a link shared before registration opened says so (without showing any detail of the draft)
    if exists (select 1 from public.events where public_code = lower(btrim(coalesce(p_code, ''))) and status = 'draft') then
      raise exception 'registration_not_open' using errcode = 'P0001';
    end if;
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  v_out := private.event_public(v_id);
  if lower(coalesce(p_ref, '')) ~ '^f-[a-z2-9]{7}$' then
    select private.first_name(full_name) into v_ref_name from public.participants
    where referral_code = lower(p_ref) and anonymized_at is null;
    v_out := v_out || jsonb_build_object('invited_by', v_ref_name);
  elsif coalesce(p_ref, '') <> '' then
    select s.key into v_src from public.referral_links l join public.acquisition_sources s on s.id = l.source_id
    where l.code = lower(btrim(p_ref)) and l.is_active and s.is_active;
    v_out := v_out || jsonb_build_object('ref_source', v_src);
  end if;
  return v_out;
end $$;

-- U1 (staff side): registrations whose typed name differs from the card, for upcoming meetings.
create or replace function private.name_mismatches()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'registration_id', r.id, 'event_id', e.id, 'event_title', e.title, 'starts_at', e.starts_at,
           'participant_id', p.id, 'card_name', p.full_name, 'typed_name', r.submitted_name) order by e.starts_at), '[]'::jsonb)
  from public.registrations r
  join public.events e on e.id = r.event_id
  join public.participants p on p.id = r.participant_id
  where r.submitted_name is not null and r.status <> 'cancelled' and e.ends_at > now() - interval '1 day'
    and e.status not in ('cancelled', 'draft')
$$;

do $$
declare
  src text;
begin
  select pg_get_functiondef('public.attention_items()'::regprocedure) into src;
  src := replace(src, '''proposals_pending'', (select count(*) from public.speakers where status = ''proposed''));',
                      '''proposals_pending'', (select count(*) from public.speakers where status = ''proposed''),
    ''name_mismatches'', private.name_mismatches());');
  execute src;
end $$;

-- ===== migration 20261106001100_staff_simulation_fixes =====
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

-- ===== migration 20261106001200_round2_fixes =====
-- Fixes from user-simulation round 2. See docs/07-qa-report.md (R1–R5, R10).

-- Patch helper: replace one exact fragment inside a function, and fail loudly if the fragment is not there.
create or replace function private.patch_function(p_sig text, p_old text, p_new text)
returns void language plpgsql set search_path = '' as $$
declare
  src text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in src) = 0 then
    raise exception 'patch_function: fragment not found in %', p_sig;
  end if;
  execute replace(src, p_old, p_new);
end $$;
revoke all on function private.patch_function(text, text, text) from public, anon, authenticated;

-- R1: at the door, a known phone that is NOT registered for this meeting is not greeted by name and not marked
-- present automatically: it goes to the short walk-in form, where the person types their own name.
select private.patch_function('public.public_checkin(jsonb)',
$o$  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part_id for update;
  if not found then
    -- a known participant who did not register: checked in as arriving without registration
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, created_via)
    values (v_event.id, v_part_id, 'registered', 'attended', true, now(), 'self_qr', 'checkin')
    returning * into v_reg;
    v_new := true;
  else$o$,
$n$  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part_id for update;
  if not found then
    -- known phone, not registered for this meeting: no name is shown; the walk-in form asks for the person's own name
    return jsonb_build_object('result', 'not_registered');
  else$n$);

-- R2: a walk-in typed at the door with a known phone but a different name keeps the typed name for staff review,
-- and the door screen is told whose card the number belongs to.
select private.patch_function('public.staff_add_walkin(uuid, jsonb)',
$o$  perform set_config('app.trusted', '', true);
  return jsonb_build_object('registration_id', v_reg.id, 'participant_is_new', v_is_new,$o$,
$n$  perform private.note_submitted_name(v_reg.id, r.full_name);
  perform set_config('app.trusted', '', true);
  return jsonb_build_object('registration_id', v_reg.id, 'participant_is_new', v_is_new,
                            'card_name', (select case when lower(btrim(p.full_name)) <> lower(btrim(r.full_name)) then p.full_name end
                                          from public.participants p where p.id = v_pid),$n$);

-- R3: follow-ups follow attendance. Coming to a meeting closes the "missed you" and "stopped coming" tasks;
-- a first visit recorded after the meeting was closed still gets its welcome call.
create or replace function private.followups_on_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_s public.settings;
begin
  if new.attendance <> 'attended' or (tg_op = 'UPDATE' and old.attendance = 'attended') then
    return new;
  end if;
  select * into v_event from public.events where id = new.event_id;
  update public.follow_ups f set status = 'cancelled',
         outcome = 'נסגר אוטומטית: הגיע/ה ל' || v_event.title || ' ב-' || to_char(v_event.starts_at at time zone 'Asia/Jerusalem', 'DD.MM')
  where f.participant_id = new.participant_id and f.status = 'open' and f.type in ('no_show', 'lapsed')
    and (f.event_id is null or f.event_id <> new.event_id);
  -- the meeting was already closed: the welcome call the closing would have created
  if v_event.status = 'completed' then
    select * into v_s from public.settings;
    if v_s.auto_task_first_time and not exists (
         select 1 from public.registrations r2 join public.events e2 on e2.id = r2.event_id
         where r2.participant_id = new.participant_id and r2.attendance = 'attended' and r2.id <> new.id and e2.starts_at < v_event.starts_at)
       and not exists (select 1 from public.follow_ups o where o.participant_id = new.participant_id and o.status = 'open') then
      insert into public.follow_ups (participant_id, event_id, type, title, due_date, assignee_id, created_by)
      values (new.participant_id, new.event_id, 'first_time', 'הגיע/ה בפעם הראשונה: שיחת היכרות ותודה',
              private.local_today() + 3, v_s.default_task_assignee, null)
      on conflict (participant_id, event_id, type) where event_id is not null do nothing;
    end if;
    -- a "missed you" task for this very meeting no longer applies
    update public.follow_ups f set status = 'cancelled', outcome = 'נסגר אוטומטית: סומן/ה כמי שהגיע/ה'
    where f.participant_id = new.participant_id and f.event_id = new.event_id and f.type = 'no_show' and f.status = 'open';
  end if;
  return new;
end $$;
create trigger registrations_followups after insert or update of attendance on public.registrations
  for each row execute function private.followups_on_attendance();

-- R4: while people are waiting, a freed seat is theirs: new registrants join the end of the queue,
-- and the public page shows the meeting as full.
create or replace function private.seats(p_event_id uuid, out registered int, out waiting int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where status = 'registered')::int, count(*) filter (where status = 'waitlisted')::int
  from public.registrations where event_id = p_event_id
$$;

select private.patch_function('private.event_public(uuid)',
$o$    select count(*)::int as registered from public.registrations r where r.event_id = e.id and r.status = 'registered'$o$,
$n$    select count(*) filter (where r.status = 'registered')::int as registered,
           count(*) filter (where r.status = 'waitlisted')::int as waiting
    from public.registrations r where r.event_id = e.id$n$);
select private.patch_function('private.event_public(uuid)',
$o$    'is_full', e.capacity is not null and c.registered >= e.capacity,
    'spots_left', case when e.capacity is not null and e.capacity - c.registered <= 10 then greatest(e.capacity - c.registered, 0) end,$o$,
$n$    'is_full', e.capacity is not null and (c.registered >= e.capacity or c.waiting > 0),
    'spots_left', case when e.capacity is not null and c.waiting > 0 then 0
                       when e.capacity is not null and e.capacity - c.registered <= 10 then greatest(e.capacity - c.registered, 0) end,$n$);

select private.patch_function('public.public_register(jsonb)',
$o$  select count(*) into v_registered from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is not null and v_registered >= v_event.capacity then$o$,
$n$  select count(*) into v_registered from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is not null and (v_registered >= v_event.capacity
       or exists (select 1 from public.registrations w where w.event_id = v_event.id and w.status = 'waitlisted')) then$n$);

-- R5: one phone, two people: when the number is already registered under a clearly different name, say so
-- honestly (without revealing that name) instead of a false "you are registered".
select private.patch_function('public.public_register(jsonb)',
$o$  if v_has_existing and v_existing.status = 'registered' then$o$,
$n$  if v_has_existing and v_existing.status in ('registered', 'waitlisted')
     and private.first_name(lower(r.full_name)) <> private.first_name(lower(v_part.full_name)) then
    return jsonb_build_object('status', 'phone_in_use', 'first_name', private.first_name(r.full_name), 'event', private.event_public(v_event.id));
  end if;
  if v_has_existing and v_existing.status = 'registered' then$n$);

-- R10: feedback from the general link is attached to a person (by phone) only if that person attended the meeting.
select private.patch_function('public.public_submit_feedback(jsonb)',
$o$      where r.event_id = v_event.id and pa.phone = v_phone;$o$,
$n$      where r.event_id = v_event.id and pa.phone = v_phone and r.attendance = 'attended';$n$);

-- ===== migration 20261106001300_membership_checkin =====
-- QR check-in v2: association membership, recognising the phone at the next check-in, a request-to-join form,
-- and the thank-you message 24 hours after a meeting. See docs/07-qa-report.md §9.
-- Numbered before 20261106009000_privilege_hardening.sql, which grants anon EXECUTE on the public_* endpoints;
-- the grant for the new endpoint is repeated at the end of this file for databases where 9000 already ran.

-- ───────────── 1. membership in the association (חבר/ת עמותה) ─────────────

alter table public.participants
  add column membership text not null default 'none' check (membership in ('none', 'requested', 'member')),
  add column membership_requested_at timestamptz,
  add column member_since date check (member_since is null or member_since between date '1990-01-01' and date '2100-12-31');
create index participants_membership_idx on public.participants (membership) where membership <> 'none';

-- new ways a card can be created / a task can exist
alter table public.participants drop constraint participants_created_via_check;
alter table public.participants add constraint participants_created_via_check
  check (created_via in ('registration', 'checkin', 'staff', 'import', 'membership_form'));
alter table public.follow_ups drop constraint follow_ups_type_check;
alter table public.follow_ups add constraint follow_ups_type_check
  check (type in ('no_show', 'first_time', 'lapsed', 'waitlist', 'general', 'membership'));
create unique index follow_ups_one_open_membership on public.follow_ups (participant_id) where type = 'membership' and status = 'open';

-- membership dates follow the status: asked → when; became a member → since today (staff can correct the date)
create or replace function private.participants_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.membership = 'none' then
    new.membership_requested_at := null;
    new.member_since := null;
  elsif new.membership = 'requested' then
    new.member_since := null;
    if tg_op = 'INSERT' or old.membership <> 'requested' then
      new.membership_requested_at := coalesce(new.membership_requested_at, now());
    end if;
  elsif new.membership = 'member' then
    new.member_since := coalesce(new.member_since, private.local_today());
  end if;
  return new;
end $$;
create trigger participants_membership before insert or update of membership, member_since, membership_requested_at on public.participants
  for each row execute function private.participants_membership();

-- a request is answered by becoming a member (or by staff setting it back): the open "asked to join" task closes itself
create or replace function private.membership_task_close()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership is distinct from old.membership and new.membership <> 'requested' then
    update public.follow_ups set status = 'done',
           outcome = case when new.membership = 'member' then 'נסגר אוטומטית: סומן/ה כחבר/ת עמותה'
                          else 'נסגר אוטומטית: בקשת ההצטרפות בוטלה בכרטיס' end
    where participant_id = new.id and type = 'membership' and status = 'open';
  end if;
  return new;
end $$;
create trigger participants_membership_task after update of membership on public.participants
  for each row execute function private.membership_task_close();

-- ───────────── 2. the phone remembers who checked in from it ─────────────
-- After a check-in, the phone keeps a random device token (localStorage). Next time, "I'm here" is one tap,
-- even without registering. Only a hash is stored here; the token never appears in a URL.

create table private.participant_devices (
  token_hash bytea primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index participant_devices_participant_idx on private.participant_devices (participant_id, last_used_at desc);
alter table private.participant_devices enable row level security;   -- no policies: only the functions below reach it
revoke all on private.participant_devices from public, anon, authenticated;

create or replace function private.issue_device(p_participant_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token text := private.new_token();
begin
  -- keep the few most recent phones of a person; phones unused for 180 days are forgotten
  delete from private.participant_devices d
  where d.participant_id = p_participant_id
    and (d.last_used_at < now() - interval '180 days'
         or d.token_hash in (select x.token_hash from private.participant_devices x
                             where x.participant_id = p_participant_id order by x.last_used_at desc offset 3));
  insert into private.participant_devices (token_hash, participant_id) values (private.token_hash(v_token), p_participant_id);
  return v_token;
end $$;

create or replace function private.device_participant(p_token text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update private.participant_devices d set last_used_at = now()
  from public.participants p
  where d.token_hash = private.token_hash(p_token) and p.id = d.participant_id and p.anonymized_at is null
    and d.last_used_at > now() - interval '180 days'
  returning d.participant_id into v_id;
  return v_id;
end $$;

-- deleting someone's personal details also forgets their phones
create or replace function private.forget_devices()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    delete from private.participant_devices where participant_id = new.id;
  end if;
  return new;
end $$;
create trigger participants_forget_devices after update of anonymized_at on public.participants
  for each row execute function private.forget_devices();

-- the check-in answer now says whether the person is a member (shown on the welcome screen)
create or replace function private.checkin_result(p_reg_id uuid, p_result text, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'result', p_result,
    'first_name', private.registrant_first_name(r),
    'token', p_token,
    'photo_opt_out', pa.photo_opt_out,
    'invite_code', pa.referral_code,
    'membership', pa.membership,
    'attended_count', (select count(*) from public.registrations x where x.participant_id = pa.id and x.attendance = 'attended'),
    'friday_count', (select count(*) from public.registrations x join public.events e on e.id = x.event_id
                     where x.participant_id = pa.id and x.attendance = 'attended' and e.type = 'friday'),
    'can_undo', r.checkin_method = 'self_qr' and r.checked_in_at > now() - interval '10 minutes',
    'event', private.event_public(r.event_id))
  from public.registrations r join public.participants pa on pa.id = r.participant_id
  where r.id = p_reg_id
$$;

-- p: { code, device? | token? | phone? }
create or replace function public.public_checkin(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  w record;
  v_reg public.registrations;
  v_phone text;
  v_part_id uuid;
  v_token text;
  v_new boolean;
begin
  perform private.rate_limit('checkin-ip:' || private.client_key(), 40, 600);
  select * into v_event from public.events where checkin_code = btrim(coalesce(p ->> 'code', '')) for update;
  if not found then
    raise exception 'checkin_not_found' using errcode = 'P0001';
  end if;
  select * into w from private.checkin_window(v_event);
  if w.state <> 'open' then
    return jsonb_build_object('result', 'window_' || w.state, 'opens_at', w.opens_at, 'event', private.event_public(v_event.id));
  end if;

  -- a phone this person checked in from before: one tap, registered for this meeting or not
  if coalesce(p ->> 'device', '') <> '' then
    v_part_id := private.device_participant(p ->> 'device');
    if v_part_id is null then
      return jsonb_build_object('result', 'device_invalid');
    end if;
    select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part_id for update;
    if not found then
      insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, created_via)
      values (v_event.id, v_part_id, 'registered', 'attended', true, now(), 'self_qr', 'checkin')
      returning * into v_reg;
      v_new := true;
    else
      v_new := private.mark_attended(v_reg.id, 'self_qr');
    end if;
    v_token := private.new_token();
    perform private.set_registration_token(v_reg.id, v_token);
    return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
           || jsonb_build_object('device', p ->> 'device');
  end if;

  if coalesce(p ->> 'token', '') <> '' then
    v_reg := private.registration_by_token(p ->> 'token');
    if v_reg.id is not null and v_reg.event_id = v_event.id then
      v_new := private.mark_attended(v_reg.id, 'self_qr');
      return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, p ->> 'token')
             || jsonb_build_object('device', private.issue_device(v_reg.participant_id));
    end if;
    if coalesce(p ->> 'phone', '') = '' then
      return jsonb_build_object('result', 'token_invalid');
    end if;
  end if;

  v_phone := private.normalize_phone(p ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  select id into v_part_id from public.participants where phone = v_phone;
  if not found then
    return jsonb_build_object('result', 'not_registered');
  end if;
  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part_id for update;
  if not found then
    -- known phone, not registered for this meeting: no name is shown; the walk-in form asks for the person's own name (R1)
    return jsonb_build_object('result', 'not_registered');
  end if;
  v_new := private.mark_attended(v_reg.id, 'self_qr');
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
         || jsonb_build_object('device', private.issue_device(v_part_id));
end $$;

-- walk-in at the door: the phone is remembered only when the typed name matches the card (or the card is new),
-- so typing someone else's number does not hand this phone their identity
select private.patch_function('public.public_walkin(jsonb)',
$o$  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token);$o$,
$n$  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
         || case when v_is_new or lower(btrim(coalesce(v_part.full_name, ''))) = lower(btrim(coalesce(r.full_name, '')))
                 then jsonb_build_object('device', private.issue_device(v_part.id)) else '{}'::jsonb end;$n$);

-- "that's not me": the phone also forgets the person it just remembered
select private.patch_function('public.public_checkin_undo(text)',
$o$  perform set_config('app.trusted', '', true);
  perform private.audit_action('checkin_undo', 'registrations', v_reg.id::text);$o$,
$n$  perform set_config('app.trusted', '', true);
  delete from private.participant_devices where participant_id = v_reg.participant_id and last_used_at > now() - interval '10 minutes';
  perform private.audit_action('checkin_undo', 'registrations', v_reg.id::text);$n$);

-- ───────────── 3. "I want to join the association" ─────────────
-- p: { device } (a phone that checked in before) | { full_name, phone }; website is a honeypot.
-- With a typed phone the answer is always the same, so the form tells nothing about who is in the system.
create or replace function public.public_membership(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pid uuid;
  v_part public.participants;
  v_known boolean := false;
  v_name text;
  v_phone text;
  v_settings public.settings;
  v_note text;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('result', 'requested');
  end if;
  perform private.rate_limit('member-ip:' || private.client_key(), 10, 3600);
  select s.* into v_settings from public.settings s;

  if coalesce(p ->> 'device', '') <> '' then
    v_pid := private.device_participant(p ->> 'device');
    if v_pid is null then
      return jsonb_build_object('result', 'device_invalid');
    end if;
    v_known := true;
  else
    v_name := private.clean_text(p ->> 'full_name', 80);
    v_phone := private.normalize_phone(p ->> 'phone');
    if v_name is null or char_length(v_name) < 2 or v_name ~ '[0-9<>@/\\{}=;]' then
      raise exception 'invalid_name' using errcode = 'P0001';
    end if;
    if v_phone is null then
      raise exception 'invalid_phone' using errcode = 'P0001';
    end if;
    perform private.rate_limit('member-phone:' || private.sha(v_phone), 3, 86400);
    select id into v_pid from public.participants where phone = v_phone;
    if v_pid is null then
      perform set_config('app.trusted', 'on', true);
      insert into public.participants (full_name, phone, created_via) values (v_name, v_phone, 'membership_form')
      returning id into v_pid;
      perform set_config('app.trusted', '', true);
    end if;
  end if;

  select * into v_part from public.participants where id = v_pid for update;
  if v_part.membership = 'none' then
    update public.participants set membership = 'requested' where id = v_pid;
    if v_name is not null and lower(btrim(v_name)) <> lower(btrim(coalesce(v_part.full_name, ''))) then
      v_note := 'השם שהוקלד בטופס: ' || v_name || '. ייתכן שהוקלד מספר טלפון של מישהו אחר, כדאי לוודא בשיחה.';
    end if;
    insert into public.follow_ups (participant_id, type, title, notes, due_date, assignee_id, created_by)
    values (v_pid, 'membership', 'ביקש/ה להצטרף לעמותה: לחזור עם פרטי ההצטרפות', v_note,
            private.local_today() + 3, v_settings.default_task_assignee, null)
    on conflict do nothing;
    perform private.audit_action('membership_request', 'participants', v_pid::text);
  end if;

  if v_known then
    return jsonb_build_object(
      'result', case v_part.membership when 'member' then 'already_member' when 'requested' then 'already_requested' else 'requested' end,
      'first_name', private.first_name(v_part.full_name));
  end if;
  return jsonb_build_object('result', 'requested');
end $$;

-- ───────────── 4. thank-you 24 hours after the meeting ─────────────
-- Nothing is sent automatically (no WhatsApp provider is connected, and every message needs a person's approval):
-- 24 hours after a meeting ends, the dashboard lists it with the number of thank-you messages still to send.
-- Members and people without consent get the thank-you; non-members who agreed to updates get the thank-you
-- with an invitation to join (a marketing message under Communications Law §30A, hence the consent).

insert into public.message_templates (key, label, audience, is_marketing, sort_order, body) values
  ('join_invite', 'תודה + הזמנה להצטרף לעמותה', 'attended', true, 35,
   '{שם_פרטי}, תודה שהיית איתנו ב{שם_המפגש}! שמחנו מאוד שהגעת.' || E'\n' ||
   'רצינו גם להזמין אותך להצטרף לעמותת המשך תנועה ולהיות חלק מהקהילה. כל הפרטים כאן: {קישור_הצטרפות}' || E'\n' ||
   'ונשמח לשמוע איך היה במפגש: {קישור_משוב}'),
  -- the reply to someone who asked to join: they asked to be contacted, so it is not a marketing message
  ('membership_reply', 'מענה לבקשת הצטרפות לעמותה', 'participant', false, 75,
   'היי {שם_פרטי}, קיבלנו את הבקשה שלך להצטרף לעמותת המשך תנועה. תודה! נשמח לספר לך על ההצטרפות. מתי נוח לך לדבר?')
on conflict (key) do nothing;

create or replace function private.aftercare_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                                               'pending', x.pending, 'join_invites', x.join_invites) order by x.ends_at), '[]'::jsonb)
  from (
    select e.id, e.title, e.starts_at, e.ends_at,
           count(*)::int as pending,
           count(*) filter (where p.membership = 'none' and p.consent_updates)::int as join_invites
    from public.events e
    join public.registrations r on r.event_id = e.id and r.attendance = 'attended'
    join public.participants p on p.id = r.participant_id and p.anonymized_at is null and p.phone is not null
    where e.status <> 'cancelled' and e.ends_at <= now() - interval '24 hours' and e.ends_at > now() - interval '7 days'
      and not exists (select 1 from public.contact_log c
                      where c.participant_id = p.id and c.event_id = e.id and c.template_key in ('thanks', 'join_invite'))
    group by e.id
  ) x
$$;

select private.patch_function('public.attention_items()',
$o$    'name_mismatches', private.name_mismatches());$o$,
$n$    'name_mismatches', private.name_mismatches(),
    'aftercare', private.aftercare_ready());$n$);

-- ───────────── 5. the door list shows members and who invited whom ─────────────
create or replace function public.staff_checkin_list(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
  v_full boolean;
begin
  select * into v_event from public.events where id = p_event_id;
  perform private.assert_door_access(v_event);
  v_full := private.has_role('admin', 'coordinator');
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.status_rank, x.display_name)
    from (
      select
        r.id as registration_id,
        case when v_full then pa.id end as participant_id,
        coalesce(pa.full_name, 'פרטים נמחקו') as display_name,
        right(pa.phone, 4) as phone_last4,
        case when v_full then pa.phone end as phone,
        r.status, r.attendance, r.is_walk_in, r.checked_in_at, r.checkin_method, r.registered_at,
        pa.photo_opt_out,
        pa.membership = 'member' as is_member,
        -- who invited them, as a first name only (the door needs no more to say thank you)
        private.first_name(coalesce(rp.full_name, r.referrer_name, pp.full_name, pa.referred_by_name)) as invited_by,
        prior.attended as prior_attended,
        prior.fridays as prior_fridays,
        prior.attended = 0 as first_time,
        case r.status when 'registered' then 0 when 'waitlisted' then 1 else 2 end as status_rank,
        case when r.status = 'waitlisted' then private.waitlist_position(r.id) end as waitlist_position
      from public.registrations r
      join public.participants pa on pa.id = r.participant_id
      left join public.participants rp on rp.id = r.referrer_participant_id and rp.anonymized_at is null
      left join public.participants pp on pp.id = pa.referred_by_participant_id and pp.anonymized_at is null
      cross join lateral (
        select count(*)::int as attended,
               count(*) filter (where e2.type = 'friday')::int as fridays
        from public.registrations r2 join public.events e2 on e2.id = r2.event_id
        where r2.participant_id = r.participant_id and r2.attendance = 'attended' and e2.starts_at < v_event.starts_at
      ) prior
      where r.event_id = p_event_id
    ) x), '[]'::jsonb);
end $$;

-- ───────────── grants ─────────────
revoke execute on function private.issue_device(uuid), private.device_participant(text), private.aftercare_ready() from public, anon;
-- attention_items() runs as the signed-in user and calls this one
grant execute on function private.aftercare_ready() to authenticated;
revoke execute on function public.public_membership(jsonb) from public;
grant execute on function public.public_membership(jsonb) to anon, authenticated;

-- ===== migration 20261106001400_known_checkin =====
-- A person the association already knows, not registered for this meeting: at the door, phone + full name is
-- enough, without the full walk-in form (their city, age and source are already on the card).
-- The answer is the same ("need_details") for an unknown phone and for a name that does not match the card, so this
-- step tells nothing about who is in the system; the name is never shown before the person typed it (R1).
-- Numbered before 20261106009000_privilege_hardening.sql; the anon grant is repeated below for databases where it ran.

create or replace function private.same_name(a text, b text)
returns boolean language sql immutable set search_path = '' as $$
  select btrim(coalesce(a, '')) <> ''
     and lower(regexp_replace(btrim(coalesce(a, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(coalesce(b, '')), '\s+', ' ', 'g'))
$$;

-- p: { code, phone, full_name, website }
create or replace function public.public_checkin_known(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  w record;
  v_phone text;
  v_name text;
  v_part public.participants;
  v_reg public.registrations;
  v_token text;
  v_new boolean;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('result', 'need_details');
  end if;
  perform private.rate_limit('known-ip:' || private.client_key(), 30, 600);
  select * into v_event from public.events where checkin_code = btrim(coalesce(p ->> 'code', '')) for update;
  if not found then
    raise exception 'checkin_not_found' using errcode = 'P0001';
  end if;
  select * into w from private.checkin_window(v_event);
  if w.state <> 'open' then
    return jsonb_build_object('result', 'window_' || w.state, 'opens_at', w.opens_at);
  end if;
  v_phone := private.normalize_phone(p ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  v_name := private.clean_text(p ->> 'full_name', 80);
  if v_name is null or char_length(v_name) < 2 or v_name ~ '[0-9<>@/\\{}=;]' then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  -- a few name attempts per phone per day: guessing who a number belongs to is not practical
  perform private.rate_limit('known-phone:' || private.sha(v_phone), 5, 86400);

  select * into v_part from public.participants where phone = v_phone and anonymized_at is null;
  if not found or not private.same_name(v_part.full_name, v_name) then
    return jsonb_build_object('result', 'need_details');
  end if;

  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  if not found then
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, created_via)
    values (v_event.id, v_part.id, 'registered', 'attended', true, now(), 'self_qr', 'checkin')
    returning * into v_reg;
    v_new := true;
  else
    v_new := private.mark_attended(v_reg.id, 'self_qr');
  end if;
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
         || jsonb_build_object('device', private.issue_device(v_part.id));
end $$;

revoke execute on function public.public_checkin_known(jsonb) from public;
grant execute on function public.public_checkin_known(jsonb) to anon, authenticated;
grant execute on function private.same_name(text, text) to authenticated;
revoke execute on function private.same_name(text, text) from public, anon;

-- ===== migration 20261106001500_site_qr =====
-- One permanent QR per site, for a sign that never changes (engraved at the entrance). It points to #/s/<site code>;
-- the page asks which meeting at this site is open for check-in right now and continues to that meeting's check-in.
-- The site code plays the role the per-meeting check-in code plays on a printed sign: it is what you see at the door.
-- Check-in is still accepted only inside each meeting's window. If the code leaks and is abused, an admin can
-- replace it (the sign then needs to be replaced too).
-- Numbered before 20261106009000_privilege_hardening.sql; the anon grant is repeated below for databases where it ran.

alter table public.sites
  add column checkin_code text not null unique default private.random_code(10) check (checkin_code ~ '^[a-z2-9]{10,20}$');

-- p_code: the site code on the sign
create or replace function public.public_site_checkin(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_site public.sites;
  v_open jsonb;
  v_next jsonb;
begin
  select * into v_site from public.sites where checkin_code = lower(btrim(coalesce(p_code, ''))) and is_active;
  if not found then
    raise exception 'site_not_found' using errcode = 'P0001';
  end if;
  -- meetings at this site open for check-in now (normally one)
  select jsonb_agg(jsonb_build_object('checkin_code', e.checkin_code, 'event', private.event_public(e.id)) order by e.starts_at)
  into v_open
  from public.events e cross join lateral private.checkin_window(e) w
  where e.site_id = v_site.id and w.state = 'open';
  -- otherwise: the next meeting here, and when its check-in opens
  if v_open is null then
    select jsonb_build_object('opens_at', w.opens_at, 'event', private.event_public(e.id))
    into v_next
    from public.events e cross join lateral private.checkin_window(e) w
    where e.site_id = v_site.id and w.state = 'not_open'
    order by e.starts_at
    limit 1;
  end if;
  return jsonb_build_object('site', v_site.name, 'open', coalesce(v_open, '[]'::jsonb), 'next', v_next);
end $$;

-- admin: a new code for a site whose sign leaked (the old sign stops working)
create or replace function public.admin_rotate_site_code(p_site_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text;
begin
  perform private.assert_role('admin');
  update public.sites set checkin_code = private.random_code(10) where id = p_site_id returning checkin_code into v_code;
  if v_code is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform private.audit_action('site_code_rotated', 'sites', p_site_id::text);
  return v_code;
end $$;

revoke execute on function public.public_site_checkin(text), public.admin_rotate_site_code(uuid) from public;
grant execute on function public.public_site_checkin(text) to anon, authenticated;
grant execute on function public.admin_rotate_site_code(uuid) to authenticated;
revoke execute on function public.admin_rotate_site_code(uuid) from anon;

-- ===== migration 20261106009000_privilege_hardening =====
-- Defense in depth: Supabase grants EXECUTE on new functions to anon and authenticated through global
-- default privileges, which a per-schema revoke cannot override. Every function already checks the
-- caller's role itself, but the anonymous surface should be exactly the public_* endpoints.
-- Keep this migration LAST (numbered 9000 so later fixes come before it); tests/api/security.test.ts pins the anonymous surface.

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
-- triggers and RLS policies run helpers in the private schema as the signed-in user; the schema is not
-- exposed through the API, so this grant does not make any of them callable from outside
grant execute on all functions in schema private to authenticated;

grant execute on function public.public_list_events() to anon;
grant execute on function public.public_get_event(text, text) to anon;
grant execute on function public.public_sources() to anon;
grant execute on function public.public_register(jsonb) to anon;
grant execute on function public.public_registration(text) to anon;
grant execute on function public.public_cancel(text, text) to anon;
grant execute on function public.public_checkin_info(text) to anon;
grant execute on function public.public_checkin(jsonb) to anon;
grant execute on function public.public_walkin(jsonb) to anon;
grant execute on function public.public_feedback_context(jsonb) to anon;
grant execute on function public.public_submit_feedback(jsonb) to anon;
grant execute on function public.public_propose(jsonb) to anon;
grant execute on function public.public_org_info() to anon;
grant execute on function public.public_checkin_undo(text) to anon;
grant execute on function public.public_membership(jsonb) to anon;
grant execute on function public.public_checkin_known(jsonb) to anon;
grant execute on function public.public_site_checkin(text) to anon;

-- the stats views are for signed-in staff only
revoke all on public.participant_stats, public.event_stats from anon, public;

-- future functions: no automatic EXECUTE for anon (applies to objects created by this role)
alter default privileges revoke execute on functions from public;
alter default privileges revoke execute on functions from anon;

-- ===== demo data (fictitious) =====
-- DEMO DATA ONLY. Fictitious people and meetings for development, screenshots, user simulations and the
-- separate hosted demo project (hemshech-tnua-demo). Never run against the production project.
-- Run:  psql "$LOCAL_DB_URL" -f supabase/demo-data.sql
-- Every name here is invented. Phones are in the 050-000xxxx range.
do $$
declare
  site uuid := '00000000-0000-4000-8000-000000000001';
  firsts text[] := array['נועם','יואב','מאיה','איתמר','שירה','עומר','דניאל','תמר','אורי','רוני','גיא','נטע','אביב','הדר','ליאור','עדי','יונתן','נוי','אלון','מיכל','רועי','שקד','איתן','ענבר','בן','יעל','עידו','רז','אסף','גל'];
  lasts text[] := array['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','פרידמן','שפירא','גולן','ברק','אזולאי','דהן','חדד','רוזן','קפלן','שגיא','טל','בר','אלמוג','נחום'];
  cities text[] := array['מודיעין','מודיעין','מודיעין','מכבים-רעות','לוד','רמלה','שהם','ירושלים','תל אביב','רחובות','מבשרת ציון','כפר האורנים'];
  src_keys text[] := array['instagram','instagram','whatsapp_group','whatsapp_group','whatsapp_group','friend','friend','friend','facebook','organization','other'];
  speakers uuid[] := '{}';
  topics text[] := array['חוסן אחרי מילואים','לחזור לעבודה אחרי סבב ארוך','זוגיות ומילואים','שינה, נשימה ומה שביניהן','איך מדברים עם הילדים','יזמות אחרי השירות','ספורט כדרך חיים','כסף, זכויות ומענקים'];
  names text[] := array['ד״ר רונן אלקיים','מיכל ברנע','אבי שטרן','נגה פלד','יוסי חזן','דנה וולף','עמית ריכטר','שרון גבאי'];
  yoga uuid;
  pilates uuid;
  ev uuid;
  evs uuid[] := '{}';
  p uuid;
  ps uuid[] := '{}';
  propensity numeric[] := '{}';
  i int;
  w int;
  d date;
  starts timestamptz;
  r record;
  v_src text;
  v_att text;
  fri date := (date_trunc('week', (now() at time zone 'Asia/Jerusalem')::date)::date + 4); -- this week's Friday
begin
  perform setseed(0.42);
  perform set_config('app.trusted', 'on', true);

  for i in 1..8 loop
    insert into public.speakers (kind, full_name, topic, bio_line, phone, status, source, created_by)
    values ('speaker', names[i], topics[i], 'מרצה אורח/ת (דמו)', '+97250000' || lpad((900 + i)::text, 4, '0'), 'proposed', 'staff', null)
    returning id into p;
    update public.speakers set status = 'approved' where id = p;
    speakers := speakers || p;
  end loop;
  insert into public.speakers (kind, full_name, topic, status, created_by) values ('instructor', 'קרן יוגה (דמו)', 'יוגה', 'proposed', null) returning id into yoga;
  update public.speakers set status = 'approved' where id = yoga;
  insert into public.speakers (kind, full_name, topic, status, created_by) values ('instructor', 'שי פילאטיס (דמו)', 'פילאטיס', 'proposed', null) returning id into pilates;
  update public.speakers set status = 'approved' where id = pilates;
  insert into public.speakers (kind, full_name, topic, bio_line, phone, status, source, proposal_message, created_by)
  values ('speaker', 'אלה מזרחי (דמו)', 'מוזיקה כדרך לעבד חוויות', 'מוזיקאית ומטפלת', '+972500000951', 'proposed', 'public_form', 'שמעתי עליכם מחבר, אשמח להתנדב להרצאה', null);

  -- 70 participants with a stable "how often they come" propensity
  for i in 1..70 loop
    v_src := src_keys[1 + floor(random() * array_length(src_keys, 1))::int];
    insert into public.participants (full_name, phone, city, birth_year, first_source_id, created_via, consent_updates, photo_opt_out, created_at)
    values (
      firsts[1 + floor(random() * array_length(firsts, 1))::int] || ' ' || lasts[1 + floor(random() * array_length(lasts, 1))::int],
      '+97250000' || lpad(i::text, 4, '0'),
      cities[1 + floor(random() * array_length(cities, 1))::int],
      (2026 - 22 - floor(random() * 25))::smallint,
      (select id from public.acquisition_sources where key = v_src),
      'registration', random() < 0.7, random() < 0.08,
      now() - make_interval(days => 80 - i)
    ) returning id into p;
    ps := ps || p;
    propensity := propensity || (case when random() < 0.25 then 0.75 when random() < 0.5 then 0.35 else 0.12 end)::numeric;
  end loop;
  -- friend referrals: some participants were brought by an earlier one
  update public.participants x set referred_by_participant_id = ps[1 + floor(random() * 20)::int]
  from public.acquisition_sources s
  where s.id = x.first_source_id and s.is_friend and x.id = any (ps[21:70]) and random() < 0.7;

  -- ten weeks back: Fridays 09:00–11:30, every fourth week a bonfire evening instead
  for w in reverse 10..1 loop
    d := fri - (w * 7);
    if w % 4 = 0 then
      starts := (d - 1 + time '19:30') at time zone 'Asia/Jerusalem';
      insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name)
      values (site, 'bonfire', 'ערב מדורה', starts, starts + interval '2.5 hours', 'החורשה ליד הולמס פלייס', 60, 'open', null)
      returning id into ev;
    else
      starts := (d + time '09:00') at time zone 'Asia/Jerusalem';
      insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id, speaker_id, lecture_topic)
      values (site, 'friday', 'מפגש שישי', starts, starts + interval '2.5 hours', 'הולמס פלייס מודיעין', 40, 'open',
              case when w % 2 = 0 then 'יוגה' else 'פילאטיס' end, case when w % 2 = 0 then yoga else pilates end,
              speakers[1 + (w % 8)], topics[1 + (w % 8)])
      returning id into ev;
    end if;
    evs := evs || ev;

    -- people join over time: only those created before the event
    for i in 1..70 loop
      continue when i > 18 + (10 - w) * 6;
      continue when random() > propensity[i] * (case when w % 4 = 0 then 0.6 else 1 end);
      v_att := case when random() < 0.82 then 'attended' else 'no_show' end;
      insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, registered_at, checked_in_at, checkin_method,
                                        how_heard_source_id, created_via)
      values (ev, ps[i], 'registered', v_att, v_att = 'attended' and random() < 0.07,
              starts - make_interval(days => 1 + floor(random() * 6)::int),
              case when v_att = 'attended' then starts + make_interval(mins => floor(random() * 40)::int - 10) end,
              case when v_att = 'attended' then (case when random() < 0.7 then 'self_qr' else 'staff' end) end,
              (select first_source_id from public.participants where id = ps[i]), 'public_form');
    end loop;
    -- a few cancellations
    update public.registrations set status = 'cancelled', attendance = 'unknown', checked_in_at = null, checkin_method = null,
           cancelled_at = starts - interval '1 day', cancelled_by = 'participant'
    where event_id = ev and attendance = 'no_show' and random() < 0.3;
    update public.events set status = 'completed' where id = ev;

    -- feedback from about half of those who came
    insert into public.feedback (event_id, registration_id, participant_id, overall_rating, activity_rating, lecture_rating, comment, source, created_at)
    select ev, r2.id, r2.participant_id,
           least(5, greatest(2, round(4.2 + (random() - 0.5) * 2)))::int,
           case when w % 4 <> 0 then least(5, greatest(1, round(4 + (random() - 0.5) * 2)))::int end,
           case when w % 4 <> 0 then least(5, greatest(1, round(3.9 + (random() - 0.5) * 2.4)))::int end,
           case when random() < 0.25 then (array['היה מעולה, תודה!','ההרצאה הייתה מרתקת','אשמח לעוד יוגה','הארוחה הייתה מושלמת','קצת צפוף, אבל אווירה טובה'])[1 + floor(random() * 5)::int] end,
           'personal_link', starts + interval '4 hours'
    from public.registrations r2 where r2.event_id = ev and r2.attendance = 'attended' and random() < 0.55;
  end loop;

  -- open follow-ups for no-shows of the last meeting
  insert into public.follow_ups (participant_id, event_id, type, title, due_date, created_by)
  select r3.participant_id, r3.event_id, 'no_show', 'נרשם/ה ולא הגיע/ה: הודעת "חסרת לנו" ושיחה', (now() at time zone 'Asia/Jerusalem')::date + 1, null
  from public.registrations r3 where r3.event_id = evs[array_length(evs, 1)] and r3.attendance = 'no_show'
  on conflict do nothing;

  -- next Friday: open for registration; the one after: a draft without a speaker yet
  starts := ((fri + case when (now() at time zone 'Asia/Jerusalem')::date > fri then 7 else 0 end) + time '09:00') at time zone 'Asia/Jerusalem';
  insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id, speaker_id, lecture_topic, description)
  values (site, 'friday', 'מפגש שישי', starts, starts + interval '2.5 hours', 'הולמס פלייס מודיעין', 40, 'open', 'יוגה', yoga, speakers[3], topics[3],
          'יוגה, הרצאת אורח, ארוחת בוקר וזמן ביחד. מתאים לכל רמה, מביאים בגדים נוחים.')
  returning id into ev;
  for i in 1..70 loop
    continue when random() > propensity[i] * 0.8;
    insert into public.registrations (event_id, participant_id, status, registered_at, how_heard_source_id, created_via)
    values (ev, ps[i], 'registered', now() - make_interval(hours => floor(random() * 100)::int),
            (select first_source_id from public.participants where id = ps[i]), 'public_form');
  end loop;
  insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id)
  values (site, 'friday', 'מפגש שישי', starts + interval '7 days', starts + interval '7 days 2.5 hours', 'הולמס פלייס מודיעין', 40, 'draft', 'פילאטיס', pilates);

  insert into public.referral_links (code, label, source_id, campaign, created_by)
  values ('ig-bio', 'ביו באינסטגרם', (select id from public.acquisition_sources where key = 'instagram'), null, null),
         ('wa-modiin', 'קבוצת המילואימניקים של מודיעין', (select id from public.acquisition_sources where key = 'whatsapp_group'), null, null)
  on conflict (code) do nothing;
  update public.registrations set referral_link_id = (select id from public.referral_links where code = 'ig-bio')
  where how_heard_source_id = (select id from public.acquisition_sources where key = 'instagram') and random() < 0.6;
end $$;

-- ===== demo: a meeting open for check-in now =====
-- DEMO ONLY: local demo and the hosted demo project, never production (run after demo-data.sql). Adds what makes the demo "live" whatever day it is run:
-- a demo meeting starting in an hour (to try QR check-in and the door list now), and this week's Friday as an
-- ended, not-yet-closed meeting (to try "סגירת המפגש") when that Friday has passed and is missing.
do $$
declare
  site uuid := '00000000-0000-4000-8000-000000000001';
  fri date := date_trunc('week', (now() at time zone 'Asia/Jerusalem')::date)::date + 4;
  starts timestamptz := (fri + time '09:00') at time zone 'Asia/Jerusalem';
  ev uuid;
  p record;
  n int := 0;
begin
  insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, description)
  values (site, 'other', 'מפגש הדגמה (לניסוי צ׳ק־אין)', now() + interval '1 hour', now() + interval '3 hours',
          'הולמס פלייס מודיעין', 30, 'open', 'יוגה', 'מפגש בדוי לניסוי: צ׳ק־אין בכניסה ורשימת נוכחות.')
  returning id into ev;
  for p in select id, first_source_id from public.participants where phone like '+97250000%' order by phone limit 8 loop
    insert into public.registrations (event_id, participant_id, status, registered_at, how_heard_source_id, created_via)
    values (ev, p.id, 'registered', now() - make_interval(hours => 5 + n), p.first_source_id, 'public_form');
    n := n + 1;
  end loop;

  if starts + interval '2.5 hours' < now()
     and not exists (select 1 from public.events e where e.type = 'friday' and (e.starts_at at time zone 'Asia/Jerusalem')::date = fri) then
    insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id, speaker_id, lecture_topic)
    select site, 'friday', 'מפגש שישי', starts, starts + interval '2.5 hours', 'הולמס פלייס מודיעין', 40, 'open', 'פילאטיס',
           (select id from public.speakers where full_name like 'שי פילאטיס%'),
           (select id from public.speakers where kind = 'speaker' and status = 'approved' order by full_name limit 1), 'זוגיות ומילואים'
    returning id into ev;
    n := 0;
    for p in select pa.id, pa.first_source_id from public.participants pa join public.participant_stats ps on ps.participant_id = pa.id
             where pa.phone like '+97250000%' order by ps.attended_count desc, pa.phone limit 20 loop
      insert into public.registrations (event_id, participant_id, status, attendance, registered_at, checked_in_at, checkin_method, how_heard_source_id, created_via)
      values (ev, p.id, 'registered', case when n % 5 = 4 then 'unknown' else 'attended' end, starts - interval '3 days',
              case when n % 5 = 4 then null else starts + make_interval(mins => n) end,
              case when n % 5 = 4 then null when n % 3 = 0 then 'staff' else 'self_qr' end, p.first_source_id, 'public_form');
      n := n + 1;
    end loop;
  end if;
end $$;

-- ===== demo: association membership =====
-- DEMO ONLY: local demo and the hosted demo project, never production (run after demo-data.sql and demo-live.sql).
-- Fictitious association membership, touching only the demo phones (+97250000…): about two thirds of the regulars
-- (3+ visits) are members, so every meeting also has non-members who get the invitation to join; and three people
-- asked to join after a meeting, each with the follow-up task the join form creates. Safe to run again.
do $$
declare
  p uuid;
begin
  update public.participants pa set membership = x.want,
         member_since = case when x.want = 'member' then x.since end
  from (
    select q.id,
           case when q.visits >= 3 and right(q.phone, 1)::int % 3 <> 0 then 'member' else 'none' end as want,
           least(private.local_today(), q.first_visit + 14) as since
    from (
      select pa2.id, pa2.phone,
             (select count(*) from public.registrations r where r.participant_id = pa2.id and r.attendance = 'attended') as visits,
             (select (min(e.starts_at) at time zone 'Asia/Jerusalem')::date
              from public.registrations r join public.events e on e.id = r.event_id
              where r.participant_id = pa2.id and r.attendance = 'attended') as first_visit
      from public.participants pa2
      where pa2.phone like '+97250000%' and pa2.anonymized_at is null and pa2.membership <> 'requested'
    ) q
  ) x
  where pa.id = x.id and pa.membership is distinct from x.want;

  if not exists (select 1 from public.participants where phone like '+97250000%' and membership = 'requested') then
    for p in select pa.id from public.participants pa
             where pa.phone like '+97250000%' and pa.anonymized_at is null and pa.membership = 'none'
               and exists (select 1 from public.registrations r where r.participant_id = pa.id and r.attendance = 'attended')
             order by pa.created_at desc limit 3 loop
      update public.participants set membership = 'requested', membership_requested_at = now() - interval '20 hours' where id = p;
      insert into public.follow_ups (participant_id, type, title, due_date, created_by)
      values (p, 'membership', 'ביקש/ה להצטרף לעמותה: לחזור עם פרטי ההצטרפות', private.local_today() + 2, null)
      on conflict do nothing;
    end loop;
  end if;
end $$;

-- ===== demo staff accounts =====
-- Demo staff accounts (demo project only). The password is not in this file, only its bcrypt hash.
-- Three fictitious staff accounts, one per role. Domain example.test is reserved and cannot receive mail.
do $$
declare
  u record;
begin
  for u in select * from (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'admin@example.test',  'הדגמה מנהל/ת',  'admin'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'coord@example.test',  'הדגמה רכז/ת',    'coordinator'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'door@example.test',   'הדגמה צוות כניסה',  'volunteer')
  ) as t(id, email, full_name, role) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            '$2a$10$T5BFfsgVQgeWzkAd8LedL.PKokLqOfHis3BXHGdkzR/6pEiRUBMuC', now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', u.id::text, now(), now(), now());
    insert into public.staff (user_id, full_name, email, role, must_change_password)
    values (u.id, u.full_name, u.email, u.role, false);
  end loop;
end $$;
