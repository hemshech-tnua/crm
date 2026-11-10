-- Staff can sign in with a one-time code sent by SMS to their phone (Supabase Auth phone OTP, no password).
-- Sign-ups stay off, so a code is sent only to the phone of an existing staff account; the account is created
-- by an admin through the staff-admin Edge Function, which sets the phone on the auth user.

alter table public.staff add column phone text unique check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
alter table public.staff alter column email drop not null;
alter table public.staff add constraint staff_has_login check (email is not null or phone is not null);

create or replace function public.staff_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', s.user_id, 'full_name', s.full_name, 'email', s.email, 'phone', s.phone, 'role', s.role,
                            'is_active', s.is_active, 'must_change_password', s.must_change_password)
  from public.staff s where s.user_id = (select auth.uid())
$$;
