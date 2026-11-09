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
