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
