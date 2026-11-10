-- Security audit (10.11.2026), independent database review, findings 1-3: a phone number is not proof of identity.
-- Anyone may know someone's phone number. Only a new person, or someone who typed the full name on the card, gets
-- anything that belongs to the card: a remembered-phone (device) token, the personal invite code, attendance counts,
-- membership, the opt-in to updates, or a replacement of the card's own registration link.
--  1. public_register / public_registration: invite code only when the name matched; consent is not added to
--     someone else's card (upsert_participant); a re-registration with another name is marked as such.
--  2. public_checkin: a phone alone no longer checks in or issues a device; the next step asks for the full name
--     (public_checkin_known), the same answer for every number. A token from a registration made under another name
--     checks in but gets no device and no card details (checkin_result). public_walkin does not replace or hand out
--     the link of an existing registration when the name does not match.
--  3. public_submit_feedback: the open event link never overwrites feedback already given.
-- CREATE OR REPLACE keeps each function's existing grants.

CREATE OR REPLACE FUNCTION private.checkin_result(p_reg_id uuid, p_result text, p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'result', p_result,
    'first_name', private.registrant_first_name(r),
    'token', p_token,
    'photo_opt_out', case when r.submitted_name is null then pa.photo_opt_out end,
    'invite_code', case when r.submitted_name is null then pa.referral_code end,
    'membership', case when r.submitted_name is null then pa.membership end,
    'attended_count', case when r.submitted_name is null then (select count(*) from public.registrations x where x.participant_id = pa.id and x.attendance = 'attended') end,
    'friday_count', case when r.submitted_name is null then (select count(*) from public.registrations x join public.events e on e.id = x.event_id
                     where x.participant_id = pa.id and x.attendance = 'attended' and e.type = 'friday') end,
    'can_undo', r.checkin_method = 'self_qr' and r.checked_in_at > now() - interval '10 minutes',
    'event', private.event_public(r.event_id))
  from public.registrations r join public.participants pa on pa.id = r.participant_id
  where r.id = p_reg_id
$function$;

CREATE OR REPLACE FUNCTION private.upsert_participant(r private.person_input, p_via text, p_referrer_id uuid, p_referrer_name text, OUT participant_id uuid, OUT is_new boolean)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  participant public.participants;
begin
  select * into participant from public.participants where phone = r.phone for update;
  if found then
    is_new := false;
    update public.participants p set
      city = coalesce(p.city, r.city),
      birth_year = coalesce(p.birth_year, r.birth_year),
      first_source_id = coalesce(p.first_source_id, r.source_id),
      first_source_detail = case when p.first_source_id is null then r.source_detail else p.first_source_detail end,
      referred_by_participant_id = case when p.first_source_id is null and p.referred_by_participant_id is null
                                        then p_referrer_id else p.referred_by_participant_id end,
      consent_updates = p.consent_updates or (r.consent and private.same_name(p.full_name, r.full_name)),
      photo_opt_out = p.photo_opt_out or r.photo_opt_out
    where p.id = participant.id;
    participant_id := participant.id;
  else
    is_new := true;
    insert into public.participants (full_name, phone, city, birth_year, first_source_id, first_source_detail,
                                     referred_by_participant_id, referred_by_name, consent_updates, photo_opt_out, created_via)
    values (r.full_name, r.phone, r.city, r.birth_year, r.source_id, r.source_detail,
            p_referrer_id, case when p_referrer_id is null then p_referrer_name end, r.consent, r.photo_opt_out, p_via)
    returning id into participant_id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.public_checkin(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
             || case when v_reg.submitted_name is null
                     then jsonb_build_object('device', private.issue_device(v_reg.participant_id)) else '{}'::jsonb end;
    end if;
    if coalesce(p ->> 'phone', '') = '' then
      return jsonb_build_object('result', 'token_invalid');
    end if;
  end if;

  v_phone := private.normalize_phone(p ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  -- A phone number alone is not proof of who is holding the phone: the next step asks for the full name
  -- (public_checkin_known), the same answer for every number, registered or not.
  return jsonb_build_object('result', 'not_registered');
end $function$;

CREATE OR REPLACE FUNCTION public.public_register(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_settings public.settings;
  r private.person_input;
  v_part public.participants;
  v_pid uuid;
  v_is_new boolean;
  v_existing public.registrations;
  v_has_existing boolean;
  v_reg_id uuid;
  v_link_id uuid;
  v_ref_id uuid;
  v_ref_name text;
  v_token text;
  v_registered int;
  v_status text;
  v_proven boolean;
begin
  if coalesce(p ->> 'website', '') <> '' then
    -- honeypot field filled: answer like a success, store nothing
    return jsonb_build_object('status', 'registered', 'first_name', private.first_name(p ->> 'full_name'));
  end if;
  perform private.rate_limit('reg-ip:' || private.client_key(), 20, 3600);

  select * into v_event from public.events where public_code = lower(btrim(coalesce(p ->> 'event', ''))) for update;
  if not found or v_event.status = 'draft' then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  if v_event.status = 'cancelled' then
    raise exception 'event_cancelled' using errcode = 'P0001';
  end if;
  if v_event.status in ('closed', 'completed') or now() >= coalesce(v_event.registration_closes_at, v_event.starts_at) then
    raise exception 'registration_closed' using errcode = 'P0001';
  end if;

  r := private.parse_person(p, true);
  perform private.rate_limit('reg-phone:' || private.sha(r.phone), 8, 3600);
  -- ceiling per event against scripted floods from many addresses (honeypot + per-IP limit catch the rest)
  perform private.rate_limit('reg-event:' || v_event.id, 150, 3600);

  select s.* into v_settings from public.settings s;
  perform set_config('app.consent_source', 'registration_form', true);
  perform set_config('app.consent_version', v_settings.consent_text_version, true);

  select x.link_id, x.referrer_id, x.referrer_name into v_link_id, v_ref_id, v_ref_name
  from private.resolve_referrer(p ->> 'ref', case when r.source_is_friend then r.referrer_text end, r.phone) x;

  select x.participant_id, x.is_new into v_pid, v_is_new
  from private.upsert_participant(r, 'registration', v_ref_id, v_ref_name) x;
  select * into v_part from public.participants where id = v_pid;
  -- a new person, or the name on the card: only then does the answer carry anything of the card (invite code, device)
  v_proven := v_is_new or private.same_name(v_part.full_name, r.full_name);

  select * into v_existing from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  v_has_existing := found;
  -- answers echo only what the visitor typed: knowing a phone number must not reveal the stored name
  if v_has_existing and v_existing.status in ('registered', 'waitlisted')
     and private.first_name(lower(r.full_name)) <> private.first_name(lower(v_part.full_name)) then
    return jsonb_build_object('status', 'phone_in_use', 'first_name', private.first_name(r.full_name), 'event', private.event_public(v_event.id));
  end if;
  if v_has_existing and v_existing.status = 'registered' then
    return jsonb_build_object('status', 'already_registered', 'first_name', private.first_name(r.full_name),
                              'event', private.event_public(v_event.id));
  end if;
  if v_has_existing and v_existing.status = 'waitlisted' then
    return jsonb_build_object('status', 'already_waitlisted', 'first_name', private.first_name(r.full_name),
                              'waitlist_position', private.waitlist_position(v_existing.id),
                              'event', private.event_public(v_event.id));
  end if;

  select count(*) into v_registered from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is not null and (v_registered >= v_event.capacity
       or exists (select 1 from public.registrations w where w.event_id = v_event.id and w.status = 'waitlisted')) then
    if not v_event.waitlist_enabled then
      raise exception 'event_full' using errcode = 'P0001';
    end if;
    v_status := 'waitlisted';
  else
    v_status := 'registered';
  end if;

  v_token := private.new_token();
  if v_has_existing then
    -- previously cancelled: register again (trusted: a new place in the queue)
    perform set_config('app.trusted', 'on', true);
    update public.registrations set
      status = v_status, registered_at = now(), attendance = 'unknown',
      cancelled_at = null, cancelled_by = null, cancel_reason = null,
      submitted_name = case when v_proven then null else r.full_name end,
      how_heard_source_id = r.source_id, how_heard_detail = r.source_detail,
      referrer_participant_id = coalesce(v_ref_id, referrer_participant_id),
      referrer_name = coalesce(v_ref_name, referrer_name),
      referral_link_id = coalesce(v_link_id, referral_link_id)
    where id = v_existing.id;
    perform set_config('app.trusted', '', true);
    perform private.set_registration_token(v_existing.id, v_token);
    v_reg_id := v_existing.id;
  else
    insert into public.registrations (
      event_id, participant_id, status, how_heard_source_id, how_heard_detail,
      referrer_participant_id, referrer_name, referral_link_id,
      utm_source, utm_medium, utm_campaign, submitted_name, manage_token_hash, created_via)
    values (
      v_event.id, v_part.id, v_status, r.source_id, r.source_detail,
      v_ref_id, v_ref_name, v_link_id,
      private.clean_text(p -> 'utm' ->> 'source', 100), private.clean_text(p -> 'utm' ->> 'medium', 100),
      private.clean_text(p -> 'utm' ->> 'campaign', 100),
      case when not v_proven then r.full_name end,
      private.token_hash(v_token), 'public_form')
    returning id into v_reg_id;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'first_name', private.first_name(r.full_name),
    'token', v_token,
    'invite_code', case when v_proven then v_part.referral_code end,
    'waitlist_position', case when v_status = 'waitlisted' then private.waitlist_position(v_reg_id) end,
    'event', private.event_public(v_event.id));
end $function$;

CREATE OR REPLACE FUNCTION public.public_registration(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'invite_code', case when v_reg.submitted_name is null then v_code end,
    'waitlist_position', case when v_reg.status = 'waitlisted' then private.waitlist_position(v_reg.id) end,
    'can_cancel', v_reg.status <> 'cancelled' and v_reg.attendance <> 'attended' and now() < v_event.starts_at
                  and v_event.status not in ('cancelled', 'completed'),
    'feedback_open', now() >= v_event.starts_at and now() <= v_event.ends_at + make_interval(days => v_days) and v_event.status <> 'cancelled',
    'feedback_given', v_fb.id is not null,
    'event', private.event_public(v_event.id));
end $function$;

CREATE OR REPLACE FUNCTION public.public_walkin(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  w record;
  r private.person_input;
  v_settings public.settings;
  v_part public.participants;
  v_pid uuid;
  v_is_new boolean;
  v_reg public.registrations;
  v_ref_id uuid;
  v_ref_name text;
  v_link_id uuid;
  v_token text;
  v_new boolean;
  v_proven boolean;
  v_had_reg boolean;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('result', 'checked_in', 'first_name', private.first_name(p ->> 'full_name'));
  end if;
  perform private.rate_limit('walkin-ip:' || private.client_key(), 15, 600);
  select * into v_event from public.events where checkin_code = btrim(coalesce(p ->> 'code', '')) for update;
  if not found then
    raise exception 'checkin_not_found' using errcode = 'P0001';
  end if;
  select * into w from private.checkin_window(v_event);
  if w.state <> 'open' then
    return jsonb_build_object('result', 'window_' || w.state, 'opens_at', w.opens_at);
  end if;
  r := private.parse_person(p, true);
  select s.* into v_settings from public.settings s;
  perform set_config('app.consent_source', 'checkin_form', true);
  perform set_config('app.consent_version', v_settings.consent_text_version, true);
  select x.link_id, x.referrer_id, x.referrer_name into v_link_id, v_ref_id, v_ref_name
  from private.resolve_referrer(null, case when r.source_is_friend then r.referrer_text end, r.phone) x;
  select x.participant_id, x.is_new into v_pid, v_is_new
  from private.upsert_participant(r, 'checkin', v_ref_id, v_ref_name) x;
  select * into v_part from public.participants where id = v_pid;
  v_proven := v_is_new or private.same_name(v_part.full_name, r.full_name);

  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  v_had_reg := found;
  if not found then
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method,
                                      how_heard_source_id, how_heard_detail, referrer_participant_id, referrer_name, created_via)
    values (v_event.id, v_part.id, 'registered', 'attended', true, now(), 'self_qr',
            r.source_id, r.source_detail, v_ref_id, v_ref_name, 'checkin')
    returning * into v_reg;
    v_new := true;
  else
    v_new := private.mark_attended(v_reg.id, 'self_qr');
  end if;
  perform private.note_submitted_name(v_reg.id, r.full_name);
  if v_had_reg and not v_proven then
    -- the registration of the person on the card: attendance is noted for staff, but its link is not replaced or handed out
    return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, null);
  end if;
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
         || case when v_proven then jsonb_build_object('device', private.issue_device(v_part.id)) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.public_submit_feedback(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_event public.events;
  v_days int;
  v_overall int;
  v_activity int;
  v_lecture int;
  v_comment text;
  v_phone text;
  v_source text;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('ok', true);
  end if;
  perform private.rate_limit('fb-ip:' || private.client_key(), 15, 3600);

  if coalesce(p ->> 'token', '') <> '' then
    v_reg := private.registration_by_token(p ->> 'token');
    if v_reg.id is null then
      raise exception 'token_invalid' using errcode = 'P0001';
    end if;
    select * into v_event from public.events where id = v_reg.event_id;
    v_source := 'personal_link';
  else
    select * into v_event from public.events where public_code = lower(btrim(coalesce(p ->> 'event', ''))) and status <> 'draft';
    if not found then
      raise exception 'event_not_found' using errcode = 'P0001';
    end if;
    v_source := 'event_link';
    if coalesce(p ->> 'phone', '') <> '' then
      v_phone := private.normalize_phone(p ->> 'phone');
      if v_phone is null then
        raise exception 'invalid_phone' using errcode = 'P0001';
      end if;
      select r.* into v_reg from public.registrations r join public.participants pa on pa.id = r.participant_id
      where r.event_id = v_event.id and pa.phone = v_phone and r.attendance = 'attended';
    end if;
    perform private.rate_limit('fb-event-ip:' || v_event.id || ':' || private.client_key(), 4, 86400);
  end if;

  select feedback_days into v_days from public.settings;
  if v_event.status = 'cancelled' or now() < v_event.starts_at then
    raise exception 'feedback_not_open' using errcode = 'P0001';
  end if;
  if now() > v_event.ends_at + make_interval(days => v_days) then
    raise exception 'feedback_closed' using errcode = 'P0001';
  end if;

  if coalesce(p ->> 'overall', '') !~ '^[1-5]$' then
    raise exception 'invalid_rating' using errcode = 'P0001';
  end if;
  v_overall := (p ->> 'overall')::int;
  if coalesce(p ->> 'activity', '') <> '' then
    if p ->> 'activity' !~ '^[1-5]$' then raise exception 'invalid_rating' using errcode = 'P0001'; end if;
    v_activity := (p ->> 'activity')::int;
  end if;
  if coalesce(p ->> 'lecture', '') <> '' then
    if p ->> 'lecture' !~ '^[1-5]$' then raise exception 'invalid_rating' using errcode = 'P0001'; end if;
    v_lecture := (p ->> 'lecture')::int;
  end if;
  v_comment := private.clean_text(p ->> 'comment', 1000);

  if v_reg.id is not null and v_source = 'personal_link' then
    -- the person's own link may correct their answer
    insert into public.feedback (event_id, registration_id, participant_id, overall_rating, activity_rating, lecture_rating, comment, source)
    values (v_event.id, v_reg.id, v_reg.participant_id, v_overall, v_activity, v_lecture, v_comment, v_source)
    on conflict (registration_id) do update set
      overall_rating = excluded.overall_rating, activity_rating = excluded.activity_rating,
      lecture_rating = excluded.lecture_rating, comment = excluded.comment;
  elsif v_reg.id is not null then
    -- the open event link + a phone number: never overwrites what is already there (anyone may know a phone number)
    insert into public.feedback (event_id, registration_id, participant_id, overall_rating, activity_rating, lecture_rating, comment, source)
    values (v_event.id, v_reg.id, v_reg.participant_id, v_overall, v_activity, v_lecture, v_comment, v_source)
    on conflict (registration_id) do nothing;
  else
    insert into public.feedback (event_id, overall_rating, activity_rating, lecture_rating, comment, source)
    values (v_event.id, v_overall, v_activity, v_lecture, v_comment, v_source);
  end if;
  return jsonb_build_object('ok', true);
end $function$;
