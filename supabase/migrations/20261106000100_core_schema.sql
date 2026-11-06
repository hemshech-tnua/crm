-- Hemshech Tnua CRM: core schema
-- Tables, constraints and indexes. Row Level Security is in 0200, audit in 0300,
-- the public API (anonymous RPCs) in 0400, staff API in 0500, reporting in 0600.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal helpers live in a schema PostgREST does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- No function in public is callable by anon/authenticated unless granted explicitly below.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

-- ───────────────────────── helpers ─────────────────────────

-- Phone numbers are stored in E.164 (+9725XXXXXXXX). Returns null when the input is not a valid number.
create or replace function private.normalize_phone(p_raw text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text;
begin
  if p_raw is null then return null; end if;
  v := regexp_replace(p_raw, '[\s\-\.\(\)‎‏‪-‮]', '', 'g');
  if v = '' then return null; end if;
  if v ~ '^00' then v := '+' || substr(v, 3); end if;
  if v ~ '^0[2-9][0-9]{7,8}$' then v := '+972' || substr(v, 2); end if;
  if v ~ '^972[2-9][0-9]{7,8}$' then v := '+' || v; end if;
  if v ~ '^\+9720' then v := '+972' || substr(v, 6); end if;
  if v ~ '^\+972' then
    -- Israeli: mobile 5X + 7 digits, landline/other 8-9 digits after 972
    if v ~ '^\+9725[0-9]{8}$' or v ~ '^\+972[2-489][0-9]{7}$' or v ~ '^\+9727[0-9]{8}$' then
      return v;
    end if;
    return null;
  end if;
  if v ~ '^\+[1-9][0-9]{7,14}$' then return v; end if;
  return null;
end $$;

-- Random code from an unambiguous alphabet (no 0/o/1/l/i).
create or replace function private.random_code(p_len int)
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  bytes bytea := extensions.gen_random_bytes(p_len);
  out text := '';
  i int;
begin
  for i in 0 .. p_len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function private.new_participant_code()
returns text language sql volatile set search_path = '' as $$
  select 'f-' || private.random_code(7)
$$;

-- URL-safe random token (returned to the participant once) and its stored hash.
create or replace function private.new_token()
returns text language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_')
$$;

create or replace function private.token_hash(p_token text)
returns bytea language sql immutable set search_path = '' as $$
  select case when p_token is null or length(p_token) < 20 or length(p_token) > 64 then null
              else extensions.digest(p_token, 'sha256') end
$$;

create or replace function private.clean_text(p text, p_max int)
returns text language sql immutable set search_path = '' as $$
  -- trims, collapses whitespace, strips control characters; empty -> null
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), '[ \t]+', ' ', 'g')), p_max), '')
$$;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

grant execute on function private.normalize_phone(text) to authenticated;
grant execute on function private.random_code(int) to authenticated;
grant execute on function private.new_participant_code() to authenticated;

-- ───────────────────────── reference tables ─────────────────────────

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  address text check (char_length(address) <= 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.acquisition_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  is_friend boolean not null default false,      -- "a friend brought me": asks who, counts toward the referral goal
  asks_detail boolean not null default false,    -- "other": free text
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  email text not null check (char_length(email) <= 254),
  role text not null check (role in ('admin', 'coordinator', 'volunteer')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Role of the signed-in user, or null (not staff, inactive, or still on a temporary password).
create or replace function private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s
  where s.user_id = (select auth.uid()) and s.is_active and not s.must_change_password
$$;

create or replace function private.has_role(variadic p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.current_role()) = any (p_roles), false)
$$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.current_role()) is not null
$$;

grant execute on function private.current_role() to authenticated;
grant execute on function private.has_role(text[]) to authenticated;
grant execute on function private.is_staff() to authenticated;

create table public.speakers (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'speaker' check (kind in ('speaker', 'instructor')),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  topic text check (char_length(topic) <= 160),
  bio_line text check (char_length(bio_line) <= 240),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  social_url text check (social_url is null or (char_length(social_url) <= 300 and social_url ~* '^https?://[^\s<>"]+$')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'declined', 'archived')),
  source text not null default 'staff' check (source in ('staff', 'public_form')),
  proposal_message text check (char_length(proposal_message) <= 1000),
  notes text check (char_length(notes) <= 1000),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index speakers_status_idx on public.speakers (status, kind);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  type text not null default 'friday' check (type in ('friday', 'bonfire', 'other')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text check (char_length(location) <= 200),
  description text check (char_length(description) <= 2000),
  capacity int check (capacity is null or capacity between 1 and 1000),
  waitlist_enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'completed', 'cancelled')),
  registration_closes_at timestamptz,
  speaker_id uuid references public.speakers(id) on delete set null,
  lecture_topic text check (char_length(lecture_topic) <= 160),
  instructor_id uuid references public.speakers(id) on delete set null,
  activity_name text check (char_length(activity_name) <= 60),
  public_code text not null unique default private.random_code(8),
  checkin_code text not null unique default private.random_code(14),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  internal_notes text check (char_length(internal_notes) <= 2000),
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_order check (ends_at > starts_at),
  constraint events_max_length check (ends_at - starts_at <= interval '24 hours'),
  constraint events_close_before_end check (registration_closes_at is null or registration_closes_at <= ends_at)
);
create index events_starts_idx on public.events (starts_at);
create index events_site_type_idx on public.events (site_id, type, starts_at);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  full_name text check (full_name is null or char_length(btrim(full_name)) between 2 and 80),
  phone text unique check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  city text check (char_length(city) <= 60),
  birth_year smallint check (birth_year is null or birth_year between 1920 and 2015),
  birth_date date check (birth_date is null or birth_date between date '1920-01-01' and date '2015-12-31'),
  occupation text check (char_length(occupation) <= 80),
  first_source_id uuid references public.acquisition_sources(id) on delete set null,
  first_source_detail text check (char_length(first_source_detail) <= 120),
  referred_by_participant_id uuid references public.participants(id) on delete set null,
  referred_by_name text check (char_length(referred_by_name) <= 80),
  referral_code text not null unique default private.new_participant_code() check (referral_code ~ '^f-[a-z2-9]{7}$'),
  consent_updates boolean not null default false,
  consent_updates_at timestamptz,
  photo_opt_out boolean not null default false,
  notes text check (char_length(notes) <= 1000),
  created_via text not null default 'staff' check (created_via in ('registration', 'checkin', 'staff', 'import')),
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participants_identity check (anonymized_at is not null or (full_name is not null and phone is not null)),
  constraint participants_no_self_referral check (referred_by_participant_id is distinct from id)
);
create index participants_name_trgm on public.participants using gin (full_name extensions.gin_trgm_ops);
create index participants_referred_by_idx on public.participants (referred_by_participant_id);
create index participants_source_idx on public.participants (first_source_id);

create table public.referral_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$' and code !~ '^f-'),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  source_id uuid references public.acquisition_sources(id) on delete set null,
  campaign text check (char_length(campaign) <= 80),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'waitlisted', 'cancelled')),
  attendance text not null default 'unknown' check (attendance in ('unknown', 'attended', 'no_show')),
  is_walk_in boolean not null default false,
  registered_at timestamptz not null default now(),
  promoted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('participant', 'staff')),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  checked_in_at timestamptz,
  checkin_method text check (checkin_method in ('self_qr', 'staff')),
  checked_in_by uuid references auth.users(id) on delete set null,
  how_heard_source_id uuid references public.acquisition_sources(id) on delete set null,
  how_heard_detail text check (char_length(how_heard_detail) <= 120),
  referrer_participant_id uuid references public.participants(id) on delete set null,
  referrer_name text check (char_length(referrer_name) <= 80),
  referral_link_id uuid references public.referral_links(id) on delete set null,
  utm_source text check (char_length(utm_source) <= 100),
  utm_medium text check (char_length(utm_medium) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  submitted_name text check (char_length(submitted_name) <= 80),
  manage_token_hash bytea unique,
  created_via text not null default 'staff' check (created_via in ('public_form', 'staff', 'checkin', 'walk_in_staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registrations_unique unique (event_id, participant_id),
  constraint registrations_cancel_time check (status <> 'cancelled' or cancelled_at is not null),
  constraint registrations_attended_registered check (attendance <> 'attended' or (status = 'registered' and checked_in_at is not null)),
  constraint registrations_not_self_referral check (referrer_participant_id is distinct from participant_id)
);
create index registrations_participant_idx on public.registrations (participant_id);
create index registrations_event_status_idx on public.registrations (event_id, status, attendance);
create index registrations_referrer_idx on public.registrations (referrer_participant_id);
create index registrations_link_idx on public.registrations (referral_link_id);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid unique references public.registrations(id) on delete set null,
  participant_id uuid references public.participants(id) on delete set null,
  overall_rating smallint not null check (overall_rating between 1 and 5),
  activity_rating smallint check (activity_rating between 1 and 5),
  lecture_rating smallint check (lecture_rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  source text not null check (source in ('personal_link', 'event_link')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_event_idx on public.feedback (event_id);
create index feedback_participant_idx on public.feedback (participant_id);

create table public.message_templates (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  body text not null check (char_length(body) between 2 and 1500),
  audience text not null check (audience in ('registered', 'waitlisted', 'attended', 'no_show', 'consented', 'participant')),
  is_marketing boolean not null default false,   -- needs the participant's consent (Communications Law §30A)
  sort_order int not null default 100,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  type text not null check (type in ('no_show', 'first_time', 'lapsed', 'waitlist', 'general')),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  notes text check (char_length(notes) <= 1000),
  due_date date,
  assignee_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  outcome text check (char_length(outcome) <= 1000),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_ups_done check (status = 'open' or completed_at is not null)
);
create unique index follow_ups_one_per_event_type on public.follow_ups (participant_id, event_id, type) where event_id is not null;
create unique index follow_ups_one_open_lapsed on public.follow_ups (participant_id) where type = 'lapsed' and status = 'open';
create index follow_ups_open_idx on public.follow_ups (status, due_date);
create index follow_ups_assignee_idx on public.follow_ups (assignee_id, status);

create table public.contact_log (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'phone', 'in_person', 'other')),
  template_key text references public.message_templates(key) on delete set null,
  summary text check (char_length(summary) <= 1000),
  event_id uuid references public.events(id) on delete set null,
  follow_up_id uuid references public.follow_ups(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index contact_log_participant_idx on public.contact_log (participant_id, created_at desc);
create index contact_log_event_idx on public.contact_log (event_id, template_key);

create table public.consents (
  id bigint generated always as identity primary key,
  participant_id uuid references public.participants(id) on delete set null,
  kind text not null check (kind in ('updates_whatsapp', 'photo_opt_out')),
  granted boolean not null,
  text_version text not null check (char_length(text_version) <= 40),
  source text not null check (source in ('registration_form', 'checkin_form', 'staff')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index consents_participant_idx on public.consents (participant_id, created_at desc);

create table public.settings (
  id boolean primary key default true check (id),
  org_name text not null default 'המשך תנועה' check (char_length(org_name) <= 80),
  default_site_id uuid references public.sites(id) on delete set null,
  default_capacity int check (default_capacity is null or default_capacity between 1 and 1000),
  regular_min_fridays int not null default 2 check (regular_min_fridays between 1 and 10),
  regular_window_days int not null default 30 check (regular_window_days between 7 and 120),
  lapsed_after_fridays int not null default 3 check (lapsed_after_fridays between 1 and 12),
  goal_avg_attendance numeric(6,1) not null default 20 check (goal_avg_attendance between 0 and 1000),
  goal_show_rate numeric(4,3) not null default 0.8 check (goal_show_rate between 0 and 1),
  goal_return_rate numeric(4,3) not null default 0.2 check (goal_return_rate between 0 and 1),
  goal_friend_share numeric(4,3) not null default 0.25 check (goal_friend_share between 0 and 1),
  goal_avg_rating numeric(3,2) not null default 4 check (goal_avg_rating between 1 and 5),
  auto_task_no_show boolean not null default true,
  auto_task_first_time boolean not null default true,
  auto_task_lapsed boolean not null default true,
  default_task_assignee uuid references auth.users(id) on delete set null,
  checkin_opens_minutes int not null default 120 check (checkin_opens_minutes between 0 and 720),
  checkin_closes_minutes int not null default 180 check (checkin_closes_minutes between 0 and 1440),
  feedback_days int not null default 14 check (feedback_days between 1 and 60),
  retention_months int not null default 36 check (retention_months between 6 and 120),
  consent_text_version text not null default '2026-11-v1' check (char_length(consent_text_version) <= 40),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,               -- no FK: history survives user deletion
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  changed_fields text[],
  details jsonb                -- never personal values; see private.audit_row()
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- Rate limiting for anonymous endpoints. Keys are hashed; nothing personal is stored.
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['sites','acquisition_sources','staff','speakers','events','participants','referral_links',
                           'registrations','feedback','follow_ups','settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function private.set_updated_at();
