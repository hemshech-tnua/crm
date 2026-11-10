-- GO LIVE (run once on the hosted project, 10.11.2026): the project that served the demo becomes the real system.
-- Removes every fictitious record and the demo staff accounts; keeps the schema, reference data (venue, sources,
-- message templates, settings) and the real staff accounts. Run in one transaction; it refuses to run unless a real
-- admin (an account with a phone, not an @example.test address) exists, so the system is never left without one.
do $$
declare
  n_real int;
begin
  select count(*) into n_real
  from public.staff s join auth.users u on u.id = s.user_id
  where s.role = 'admin' and s.is_active and s.phone is not null and coalesce(u.email, '') not like '%@example.test';
  if n_real = 0 then
    raise exception 'No real admin account yet. Go-live refused.';
  end if;

  -- fictitious activity and people (order follows the foreign keys)
  delete from public.feedback;
  delete from public.contact_log;
  delete from public.follow_ups;
  delete from public.consents;
  delete from public.registrations;
  delete from public.duplicate_dismissals;
  delete from public.participants;
  delete from public.events;
  delete from public.speakers;
  delete from public.referral_links;
  delete from private.participant_devices;
  delete from private.rate_limits;

  -- demo staff accounts (the demo password was shared in chat) and any account that is not on the staff list
  delete from auth.users u
  where coalesce(u.email, '') like '%@example.test'
     or not exists (select 1 from public.staff s where s.user_id = u.id);

  -- a fresh start: no demo-era history, a new code for the venue sign, a new salt for rate-limit keys
  delete from public.audit_log;
  update public.sites set checkin_code = private.random_code(10);
  update private.app_secrets set value = encode(extensions.gen_random_bytes(32), 'hex') where name = 'ip_salt';
  update public.settings set default_task_assignee = null, contact_phone = null;

  perform private.audit_action('go_live', 'settings', null, jsonb_build_object('note', 'demo data removed; the system is live'));
end $$;
