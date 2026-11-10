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
