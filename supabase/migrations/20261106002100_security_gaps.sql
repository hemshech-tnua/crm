-- Security spec follow-up (15.11.2026): closing the gaps listed under "remaining risks".
--  1. Two-step sign-in (TOTP, Supabase Auth MFA): a staff member who turned it on gets no role in the database until
--     the session is verified with a code (aal2). Opt-in per person, so nobody is locked out by this change; an admin
--     can reset another member's second step (staff-admin reset_mfa).
--  2. private.client_key: without Cloudflare's header, take the right-most X-Forwarded-For hop (the one our own proxy
--     appended), never the client-controlled left end. On Supabase cf-connecting-ip is always present.
--  3. admin_security_overview(): what an admin should look at — accounts that are not staff (open sign-up), sign-in
--     lockouts and throttled abuse in the last 24 hours, who has two-step sign-in, recent permission changes.

create or replace function private."current_role"()
returns text language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s
  where s.user_id = (select auth.uid()) and s.is_active and not s.must_change_password
    and (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
         or not exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'))
$$;

create or replace function public.staff_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', s.user_id, 'full_name', s.full_name, 'email', s.email, 'phone', s.phone, 'role', s.role,
                            'is_active', s.is_active, 'must_change_password', s.must_change_password,
                            'mfa_enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'),
                            'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'))
  from public.staff s where s.user_id = (select auth.uid())
$$;

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
  ip := coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip',
                 (regexp_split_to_array(coalesce(h ->> 'x-forwarded-for', ''), '\s*,\s*'))[
                   cardinality(regexp_split_to_array(coalesce(h ->> 'x-forwarded-for', ''), '\s*,\s*'))]);
  ip := coalesce(nullif(btrim(ip), ''), 'unknown');
  return encode(extensions.digest(ip || (select value from private.app_secrets where name = 'ip_salt'), 'sha256'), 'hex');
end $$;

create or replace function public.admin_security_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.assert_role('admin');
  select jsonb_build_object(
    -- signed-up accounts with no staff row: harmless today (RLS gives them nothing) but a sign that open sign-up is used
    'unknown_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', u.created_at, 'email', u.email, 'phone', u.phone) order by u.created_at desc)
      from auth.users u where not exists (select 1 from public.staff s where s.user_id = u.id)), '[]'::jsonb),
    -- throttles that reached their limit in the last 24 hours (a counter at its limit = further attempts were refused)
    'limits_24h', (
      select jsonb_build_object(
        'staff_phone_locked', count(*) filter (where key like 'pwlogin-phone:%' and hits >= 8),
        'staff_ip_blocked', count(*) filter (where key like 'pwlogin-ip:%' and hits >= 30),
        'invite_probing', count(*) filter (where (key like 'claim-ip:%' and hits >= 20) or (key like 'claim-token:%' and hits >= 10)),
        'door_name_guessing', count(*) filter (where key like 'known-phone:%' and hits >= 5),
        'form_flooding', count(*) filter (where (key like 'reg-ip:%' and hits >= 20) or (key like 'checkin-ip:%' and hits >= 40)
                                              or (key like 'walkin-ip:%' and hits >= 15) or (key like 'fb-ip:%' and hits >= 15)))
      from private.rate_limits where window_start > now() - interval '24 hours'),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', s.user_id, 'full_name', s.full_name, 'role', s.role, 'is_active', s.is_active,
               'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'),
               'last_sign_in_at', u.last_sign_in_at) order by s.role, s.full_name)
      from public.staff s left join auth.users u on u.id = s.user_id), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r.x order by r.at desc) from (
        select jsonb_build_object('at', a.at, 'action', a.action,
                                  'actor', (select s.full_name from public.staff s where s.user_id = a.actor_id),
                                  'target', (select s.full_name from public.staff s where s.user_id::text = a.entity_id)) as x, a.at as at
        from public.audit_log a
        where a.at > now() - interval '30 days'
          and (a.action in ('staff_create', 'staff_update', 'staff_reset_password', 'staff_invite', 'staff_first_entry',
                            'password_changed', 'mfa_reset', 'site_code_rotated', 'anonymize', 'export', 'go_live')
               or (a.entity = 'staff' and a.action in ('insert', 'update', 'delete')))
        order by a.at desc limit 30) r), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke execute on function public.admin_security_overview() from public, anon;
grant execute on function public.admin_security_overview() to authenticated;
