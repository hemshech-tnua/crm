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
