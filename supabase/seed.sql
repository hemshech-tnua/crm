-- LOCAL DEVELOPMENT AND TESTS ONLY. Never runs on the hosted project (supabase db push does not seed).
-- Three fictitious staff accounts, one per role. Domain example.test is reserved and cannot receive mail.
do $$
declare
  u record;
begin
  for u in select * from (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'admin@example.test',  'בדיקה מנהלת',  'admin'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'coord@example.test',  'בדיקה רכז',    'coordinator'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'door@example.test',   'בדיקה כניסה',  'volunteer')
  ) as t(id, email, full_name, role) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('Local-Test-2026', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', u.id::text, now(), now(), now());
    insert into public.staff (user_id, full_name, email, role, must_change_password)
    values (u.id, u.full_name, u.email, u.role, false);
  end loop;
end $$;
