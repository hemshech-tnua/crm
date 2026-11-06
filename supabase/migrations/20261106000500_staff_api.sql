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
