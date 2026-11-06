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
