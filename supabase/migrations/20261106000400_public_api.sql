-- Public API: the only entry points for anonymous visitors (registration, cancellation, self check-in,
-- feedback, presenter proposals). Each function validates every input on the server, is rate limited,
-- returns only the fields the visitor needs, and never exposes another person's data.
-- Errors are raised as short codes (message) that the app maps to Hebrew text.

-- A per-installation random salt for hashing client IPs in the rate limiter.
create table private.app_secrets (
  name text primary key,
  value text not null
);
insert into private.app_secrets (name, value)
values ('ip_salt', encode(extensions.gen_random_bytes(32), 'hex'));

create or replace function private.client_key()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  h jsonb;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  ip := coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1));
  ip := coalesce(nullif(btrim(ip), ''), 'unknown');
  return encode(extensions.digest(ip || (select value from private.app_secrets where name = 'ip_salt'), 'sha256'), 'hex');
end $$;

create or replace function private.rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits as rl (key, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into v_hits;
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  if v_hits > p_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
end $$;

create or replace function private.sha(p text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

create or replace function private.first_name(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(split_part(btrim(coalesce(p, '')), ' ', 1), '')
$$;

create or replace function private.local_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Jerusalem')::date
$$;

-- What a visitor may see about an event. Unapproved speakers are never shown.
create or replace function private.event_public(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', e.public_code,
    'title', e.title,
    'type', e.type,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'location', coalesce(e.location, si.address, si.name),
    'site_name', si.name,
    'description', e.description,
    'activity_name', e.activity_name,
    'instructor_name', case when i.status = 'approved' then i.full_name end,
    'speaker_name', case when s.status = 'approved' then s.full_name end,
    'speaker_bio', case when s.status = 'approved' then s.bio_line end,
    'lecture_topic', coalesce(e.lecture_topic, case when s.status = 'approved' then s.topic end),
    'status', e.status,
    'registration_open', e.status = 'open' and now() < coalesce(e.registration_closes_at, e.starts_at),
    'is_full', e.capacity is not null and c.registered >= e.capacity,
    'spots_left', case when e.capacity is not null and e.capacity - c.registered <= 10 then greatest(e.capacity - c.registered, 0) end,
    'waitlist_enabled', e.waitlist_enabled
  )
  from public.events e
  join public.sites si on si.id = e.site_id
  left join public.speakers s on s.id = e.speaker_id
  left join public.speakers i on i.id = e.instructor_id
  cross join lateral (
    select count(*)::int as registered from public.registrations r where r.event_id = e.id and r.status = 'registered'
  ) c
  where e.id = p_event_id
$$;

-- ───────────── input parsing shared by registration and walk-in ─────────────

create type private.person_input as (
  full_name text,
  phone text,
  city text,
  birth_year smallint,
  source_id uuid,
  source_is_friend boolean,
  source_detail text,
  referrer_text text,
  consent boolean,
  photo_opt_out boolean
);

create or replace function private.parse_person(p jsonb, p_require_all boolean default true)
returns private.person_input language plpgsql stable security definer set search_path = '' as $$
declare
  r private.person_input;
  v_age_text text := btrim(coalesce(p ->> 'age', ''));
  v_age int;
  v_src record;
begin
  r.full_name := private.clean_text(p ->> 'full_name', 80);
  if r.full_name is null or char_length(r.full_name) < 2 or r.full_name ~ '[0-9<>@/\\{}=;]' or r.full_name ~* 'https?:|www\.' then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  r.phone := private.normalize_phone(p ->> 'phone');
  if r.phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;

  r.city := private.clean_text(p ->> 'city', 60);
  if r.city is not null and (char_length(r.city) < 2 or r.city ~ '[0-9<>@/\\{}=;]') then
    raise exception 'invalid_city' using errcode = 'P0001';
  end if;
  if r.city is null and p_require_all then
    raise exception 'invalid_city' using errcode = 'P0001';
  end if;

  if v_age_text <> '' then
    if v_age_text !~ '^[0-9]{1,3}$' then
      raise exception 'invalid_age' using errcode = 'P0001';
    end if;
    v_age := v_age_text::int;
    if v_age < 16 or v_age > 99 then
      raise exception 'invalid_age' using errcode = 'P0001';
    end if;
    r.birth_year := (extract(year from now() at time zone 'Asia/Jerusalem')::int - v_age)::smallint;
  elsif p_require_all then
    raise exception 'invalid_age' using errcode = 'P0001';
  end if;

  if coalesce(p ->> 'source', '') <> '' then
    select id, is_friend into v_src from public.acquisition_sources where key = p ->> 'source' and is_active;
    if not found then
      raise exception 'invalid_source' using errcode = 'P0001';
    end if;
    r.source_id := v_src.id;
    r.source_is_friend := v_src.is_friend;
  elsif p_require_all then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;

  r.source_detail := private.clean_text(p ->> 'source_detail', 120);
  r.referrer_text := private.clean_text(p ->> 'referrer', 80);
  r.consent := coalesce((p ->> 'consent_updates') = 'true', false);
  r.photo_opt_out := coalesce((p ->> 'photo_opt_out') = 'true', false);
  return r;
end $$;

-- Who referred this person: a channel link (?ref=ig-bio), a personal invite link (?ref=f-xxxxxxx),
-- or the "who brought you" answer (a phone of an existing participant, or a name kept as text).
create or replace function private.resolve_referrer(p_ref text, p_referrer_text text, p_self_phone text,
                                                    out link_id uuid, out referrer_id uuid, out referrer_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_code text := lower(btrim(coalesce(p_ref, '')));
  v_phone text;
begin
  if v_code ~ '^[a-z0-9][a-z0-9-]{1,39}$' then
    if v_code ~ '^f-' then
      select p.id into referrer_id from public.participants p
      where p.referral_code = v_code and p.anonymized_at is null and p.phone is distinct from p_self_phone;
    else
      select l.id into link_id from public.referral_links l where l.code = v_code and l.is_active;
    end if;
  end if;
  if referrer_id is null and p_referrer_text is not null then
    v_phone := private.normalize_phone(p_referrer_text);
    if v_phone is not null and v_phone <> p_self_phone then
      select p.id into referrer_id from public.participants p where p.phone = v_phone;
    end if;
    if referrer_id is null then
      referrer_name := p_referrer_text;
    end if;
  end if;
end $$;

-- Find the participant by phone or create them. Existing details are never overwritten from a public form
-- (only blanks are filled), so knowing someone's phone does not let you change their record.
create or replace function private.upsert_participant(r private.person_input, p_via text, p_referrer_id uuid, p_referrer_name text,
                                                      out participant_id uuid, out is_new boolean)
language plpgsql security definer set search_path = '' as $$
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
      consent_updates = p.consent_updates or r.consent,
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
end $$;

create or replace function private.waitlist_position(p_reg_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.registrations o
  join public.registrations me on me.id = p_reg_id
  where o.event_id = me.event_id and o.status = 'waitlisted' and o.registered_at <= me.registered_at
$$;

-- ───────────── public endpoints ─────────────

create or replace function public.public_list_events()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.event_public(e.id) order by e.starts_at), '[]'::jsonb)
  from (
    select id, starts_at from public.events
    where status = 'open' and starts_at > now() and now() < coalesce(registration_closes_at, starts_at)
    order by starts_at limit 12
  ) e
$$;

create or replace function public.public_get_event(p_code text, p_ref text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v_out jsonb;
  v_ref_name text;
begin
  select id into v_id from public.events where public_code = lower(btrim(coalesce(p_code, ''))) and status <> 'draft';
  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  v_out := private.event_public(v_id);
  if lower(coalesce(p_ref, '')) ~ '^f-[a-z2-9]{7}$' then
    select private.first_name(full_name) into v_ref_name from public.participants
    where referral_code = lower(p_ref) and anonymized_at is null;
    v_out := v_out || jsonb_build_object('invited_by', v_ref_name);
  end if;
  return v_out;
end $$;

create or replace function public.public_sources()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'is_friend', is_friend, 'asks_detail', asks_detail)
                            order by sort_order, label), '[]'::jsonb)
  from public.acquisition_sources where is_active
$$;

create or replace function public.public_register(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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

  select * into v_existing from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  v_has_existing := found;
  -- answers echo only what the visitor typed: knowing a phone number must not reveal the stored name
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
  if v_event.capacity is not null and v_registered >= v_event.capacity then
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
      case when not v_is_new and lower(r.full_name) <> lower(v_part.full_name) then r.full_name end,
      private.token_hash(v_token), 'public_form')
    returning id into v_reg_id;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'first_name', private.first_name(r.full_name),
    'token', v_token,
    'invite_code', v_part.referral_code,
    'waitlist_position', case when v_status = 'waitlisted' then private.waitlist_position(v_reg_id) end,
    'event', private.event_public(v_event.id));
end $$;

-- Setting a manage token bypasses the registrations guard (which freezes the hash on normal updates).
create or replace function private.set_registration_token(p_reg_id uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := current_setting('app.trusted', true);
begin
  perform set_config('app.trusted', 'on', true);
  update public.registrations set manage_token_hash = private.token_hash(p_token) where id = p_reg_id;
  perform set_config('app.trusted', coalesce(v_prev, ''), true);
end $$;

create or replace function private.registration_by_token(p_token text)
returns public.registrations language sql stable security definer set search_path = '' as $$
  select * from public.registrations where manage_token_hash = private.token_hash(p_token)
$$;

-- The participant's own registration, via the personal link they received when registering.
create or replace function public.public_registration(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_name text;
  v_code text;
  v_fb public.feedback;
  v_days int;
begin
  v_reg := private.registration_by_token(p_token);
  if v_reg.id is null then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  select private.first_name(full_name), referral_code into v_name, v_code from public.participants where id = v_reg.participant_id;
  select * into v_fb from public.feedback where registration_id = v_reg.id;
  select feedback_days into v_days from public.settings;
  return jsonb_build_object(
    'status', v_reg.status,
    'attendance', v_reg.attendance,
    'first_name', v_name,
    'invite_code', v_code,
    'waitlist_position', case when v_reg.status = 'waitlisted' then private.waitlist_position(v_reg.id) end,
    'can_cancel', v_reg.status <> 'cancelled' and now() < v_event.starts_at and v_event.status not in ('cancelled', 'completed'),
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
  if now() >= v_event.starts_at or v_event.status in ('cancelled', 'completed') then
    raise exception 'too_late' using errcode = 'P0001';
  end if;
  if v_reg.status <> 'cancelled' then
    update public.registrations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'participant',
           cancel_reason = private.clean_text(p_reason, 300)
    where id = v_reg.id;
  end if;
  return jsonb_build_object('status', 'cancelled');
end $$;

-- ───────────── self check-in (QR at the entrance) ─────────────

create or replace function private.checkin_window(p_event public.events, out state text, out opens_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.settings;
begin
  select * into v_s from public.settings;
  opens_at := p_event.starts_at - make_interval(mins => v_s.checkin_opens_minutes);
  if p_event.status in ('draft', 'cancelled') then
    state := 'unavailable';
  elsif now() < opens_at then
    state := 'not_open';
  elsif now() > p_event.ends_at + make_interval(mins => v_s.checkin_closes_minutes) then
    state := 'closed';
  else
    state := 'open';
  end if;
end $$;

create or replace function public.public_checkin_info(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
  w record;
begin
  select * into v_event from public.events where checkin_code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'checkin_not_found' using errcode = 'P0001';
  end if;
  select * into w from private.checkin_window(v_event);
  return jsonb_build_object('window', w.state, 'opens_at', w.opens_at, 'event', private.event_public(v_event.id));
end $$;

create or replace function private.checkin_result(p_reg_id uuid, p_result text, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'result', p_result,
    'first_name', private.first_name(pa.full_name),
    'token', p_token,
    'photo_opt_out', pa.photo_opt_out,
    'invite_code', pa.referral_code,
    'attended_count', (select count(*) from public.registrations x where x.participant_id = pa.id and x.attendance = 'attended'),
    'friday_count', (select count(*) from public.registrations x join public.events e on e.id = x.event_id
                     where x.participant_id = pa.id and x.attendance = 'attended' and e.type = 'friday'),
    'event', private.event_public(r.event_id))
  from public.registrations r join public.participants pa on pa.id = r.participant_id
  where r.id = p_reg_id
$$;

create or replace function private.mark_attended(p_reg_id uuid, p_method text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_was text;
begin
  select attendance into v_was from public.registrations where id = p_reg_id for update;
  if v_was = 'attended' then
    return false;
  end if;
  update public.registrations set status = 'registered', attendance = 'attended', checked_in_at = now(),
         checkin_method = p_method, checked_in_by = (select auth.uid())
  where id = p_reg_id;
  return true;
end $$;

-- p: { code, token?, phone? }
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

  if coalesce(p ->> 'token', '') <> '' then
    v_reg := private.registration_by_token(p ->> 'token');
    if v_reg.id is not null and v_reg.event_id = v_event.id then
      v_new := private.mark_attended(v_reg.id, 'self_qr');
      return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, p ->> 'token');
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
    -- a known participant who did not register: checked in as arriving without registration
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, created_via)
    values (v_event.id, v_part_id, 'registered', 'attended', true, now(), 'self_qr', 'checkin')
    returning * into v_reg;
    v_new := true;
  else
    v_new := private.mark_attended(v_reg.id, 'self_qr');
  end if;
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token);
end $$;

-- Arrived without registering and unknown to us: short form at the door.
create or replace function public.public_walkin(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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

  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
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
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token);
end $$;

-- ───────────── feedback after the meeting ─────────────

-- p: { token? , event? }
create or replace function public.public_feedback_context(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_fb public.feedback;
  v_days int;
  v_state text;
  v_name text;
begin
  if coalesce(p ->> 'token', '') <> '' then
    v_reg := private.registration_by_token(p ->> 'token');
    if v_reg.id is null then
      raise exception 'token_invalid' using errcode = 'P0001';
    end if;
    select * into v_event from public.events where id = v_reg.event_id;
    select * into v_fb from public.feedback where registration_id = v_reg.id;
    select private.first_name(full_name) into v_name from public.participants where id = v_reg.participant_id;
  else
    select * into v_event from public.events where public_code = lower(btrim(coalesce(p ->> 'event', ''))) and status <> 'draft';
    if not found then
      raise exception 'event_not_found' using errcode = 'P0001';
    end if;
  end if;
  select feedback_days into v_days from public.settings;
  v_state := case
    when v_event.status = 'cancelled' then 'closed'
    when now() < v_event.starts_at then 'not_yet'
    when now() > v_event.ends_at + make_interval(days => v_days) then 'closed'
    else 'open' end;
  return jsonb_build_object(
    'state', v_state,
    'first_name', v_name,
    'personal', v_reg.id is not null,
    'has_activity', v_event.activity_name is not null or v_event.instructor_id is not null,
    'has_lecture', v_event.speaker_id is not null or v_event.lecture_topic is not null,
    'existing', case when v_fb.id is not null then jsonb_build_object(
        'overall', v_fb.overall_rating, 'activity', v_fb.activity_rating, 'lecture', v_fb.lecture_rating, 'comment', v_fb.comment) end,
    'event', private.event_public(v_event.id));
end $$;

-- p: { token? | event + phone?, overall, activity?, lecture?, comment?, website }
create or replace function public.public_submit_feedback(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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
      where r.event_id = v_event.id and pa.phone = v_phone;
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

  if v_reg.id is not null then
    insert into public.feedback (event_id, registration_id, participant_id, overall_rating, activity_rating, lecture_rating, comment, source)
    values (v_event.id, v_reg.id, v_reg.participant_id, v_overall, v_activity, v_lecture, v_comment, v_source)
    on conflict (registration_id) do update set
      overall_rating = excluded.overall_rating, activity_rating = excluded.activity_rating,
      lecture_rating = excluded.lecture_rating, comment = excluded.comment;
  else
    insert into public.feedback (event_id, overall_rating, activity_rating, lecture_rating, comment, source)
    values (v_event.id, v_overall, v_activity, v_lecture, v_comment, v_source);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── "propose yourself as a speaker / instructor" ─────────────

create or replace function public.public_propose(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_kind text := coalesce(p ->> 'kind', 'speaker');
  v_name text := private.clean_text(p ->> 'full_name', 80);
  v_phone text := private.normalize_phone(p ->> 'phone');
  v_topic text := private.clean_text(p ->> 'topic', 160);
  v_bio text := private.clean_text(p ->> 'bio_line', 240);
  v_url text := private.clean_text(p ->> 'social_url', 300);
  v_msg text := private.clean_text(p ->> 'message', 1000);
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('ok', true);
  end if;
  perform private.rate_limit('propose-ip:' || private.client_key(), 5, 3600);
  if v_kind not in ('speaker', 'instructor') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) < 2 or v_name ~ '[0-9<>@/\\{}=;]' then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if v_topic is null or char_length(v_topic) < 2 then
    raise exception 'invalid_topic' using errcode = 'P0001';
  end if;
  if v_url is not null and v_url !~* '^https?://[^\s<>"]+$' then
    raise exception 'invalid_url' using errcode = 'P0001';
  end if;
  perform private.rate_limit('propose-phone:' || private.sha(v_phone), 3, 86400);
  insert into public.speakers (kind, full_name, phone, topic, bio_line, social_url, proposal_message, status, source, created_by)
  values (v_kind, v_name, v_phone, v_topic, v_bio, v_url, v_msg, 'proposed', 'public_form', null);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.public_list_events() to anon, authenticated;
grant execute on function public.public_get_event(text, text) to anon, authenticated;
grant execute on function public.public_sources() to anon, authenticated;
grant execute on function public.public_register(jsonb) to anon, authenticated;
grant execute on function public.public_registration(text) to anon, authenticated;
grant execute on function public.public_cancel(text, text) to anon, authenticated;
grant execute on function public.public_checkin_info(text) to anon, authenticated;
grant execute on function public.public_checkin(jsonb) to anon, authenticated;
grant execute on function public.public_walkin(jsonb) to anon, authenticated;
grant execute on function public.public_feedback_context(jsonb) to anon, authenticated;
grant execute on function public.public_submit_feedback(jsonb) to anon, authenticated;
grant execute on function public.public_propose(jsonb) to anon, authenticated;
