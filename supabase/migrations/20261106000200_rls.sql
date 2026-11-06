-- Row Level Security: who can read and change what.
-- Roles: admin (מנהל), coordinator (רכז), volunteer (צוות כניסה). Anonymous visitors get no table access at all;
-- they only call the SECURITY DEFINER functions in 0400 that validate every input.
-- Volunteers never read participant tables directly; they use staff_checkin_list(), which returns minimal columns.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sites','acquisition_sources','staff','speakers','events','participants','referral_links',
                           'registrations','feedback','message_templates','follow_ups','contact_log','consents',
                           'settings','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- sites
grant select, insert, update on public.sites to authenticated;
create policy sites_read on public.sites for select to authenticated using ((select private.is_staff()));
create policy sites_insert on public.sites for insert to authenticated with check ((select private.has_role('admin')));
create policy sites_update on public.sites for update to authenticated using ((select private.has_role('admin'))) with check (true);

-- acquisition sources
grant select, insert, update on public.acquisition_sources to authenticated;
create policy sources_read on public.acquisition_sources for select to authenticated using ((select private.is_staff()));
create policy sources_insert on public.acquisition_sources for insert to authenticated with check ((select private.has_role('admin')));
create policy sources_update on public.acquisition_sources for update to authenticated using ((select private.has_role('admin'))) with check (true);

-- staff: everyone sees their own row (also while on a temporary password); active staff see colleagues' names.
-- Changes go through the staff-admin Edge Function (service role), never directly.
grant select on public.staff to authenticated;
create policy staff_read on public.staff for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));

-- speakers (מרצים ומדריכים)
grant select, insert, update, delete on public.speakers to authenticated;
create policy speakers_read on public.speakers for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy speakers_insert on public.speakers for insert to authenticated with check ((select private.has_role('admin', 'coordinator')));
create policy speakers_update on public.speakers for update to authenticated
  using ((select private.has_role('admin', 'coordinator'))) with check ((select private.has_role('admin', 'coordinator')));
create policy speakers_delete on public.speakers for delete to authenticated using ((select private.has_role('admin')));

-- events: all staff read (the door team needs the list); admin + coordinator write; admin deletes empty events only
grant select, insert, update, delete on public.events to authenticated;
create policy events_read on public.events for select to authenticated using ((select private.is_staff()));
create policy events_insert on public.events for insert to authenticated with check ((select private.has_role('admin', 'coordinator')));
create policy events_update on public.events for update to authenticated
  using ((select private.has_role('admin', 'coordinator'))) with check ((select private.has_role('admin', 'coordinator')));
create policy events_delete on public.events for delete to authenticated using ((select private.has_role('admin')));

-- participants: admin + coordinator. No direct delete: anonymize/merge functions only.
grant select, insert, update on public.participants to authenticated;
create policy participants_read on public.participants for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy participants_insert on public.participants for insert to authenticated with check ((select private.has_role('admin', 'coordinator')));
create policy participants_update on public.participants for update to authenticated
  using ((select private.has_role('admin', 'coordinator')) and anonymized_at is null)
  with check ((select private.has_role('admin', 'coordinator')) and anonymized_at is null);

-- referral links
grant select, insert, update on public.referral_links to authenticated;
create policy links_read on public.referral_links for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy links_insert on public.referral_links for insert to authenticated with check ((select private.has_role('admin', 'coordinator')));
create policy links_update on public.referral_links for update to authenticated
  using ((select private.has_role('admin', 'coordinator'))) with check ((select private.has_role('admin', 'coordinator')));

-- registrations: admin + coordinator read/write. Attendance at the door goes through staff_* functions.
grant select, insert, update on public.registrations to authenticated;
create policy registrations_read on public.registrations for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy registrations_insert on public.registrations for insert to authenticated with check ((select private.has_role('admin', 'coordinator')));
create policy registrations_update on public.registrations for update to authenticated
  using ((select private.has_role('admin', 'coordinator'))) with check ((select private.has_role('admin', 'coordinator')));

-- feedback: read by admin + coordinator; only admin removes (moderation). Written only by the public function.
grant select, delete on public.feedback to authenticated;
create policy feedback_read on public.feedback for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy feedback_delete on public.feedback for delete to authenticated using ((select private.has_role('admin')));

-- message templates
grant select, insert, update on public.message_templates to authenticated;
create policy templates_read on public.message_templates for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy templates_insert on public.message_templates for insert to authenticated with check ((select private.has_role('admin')));
create policy templates_update on public.message_templates for update to authenticated using ((select private.has_role('admin'))) with check (true);

-- follow-ups
grant select, insert, update on public.follow_ups to authenticated;
create policy follow_ups_read on public.follow_ups for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy follow_ups_insert on public.follow_ups for insert to authenticated with check ((select private.has_role('admin', 'coordinator')));
create policy follow_ups_update on public.follow_ups for update to authenticated
  using ((select private.has_role('admin', 'coordinator'))) with check ((select private.has_role('admin', 'coordinator')));

-- contact log: append-only for coordinators; admin can remove a mistaken entry
grant select, insert, delete on public.contact_log to authenticated;
create policy contact_read on public.contact_log for select to authenticated using ((select private.has_role('admin', 'coordinator')));
create policy contact_insert on public.contact_log for insert to authenticated
  with check ((select private.has_role('admin', 'coordinator')) and created_by = (select auth.uid()));
create policy contact_delete on public.contact_log for delete to authenticated using ((select private.has_role('admin')));

-- consents: read-only history, written by trigger
grant select on public.consents to authenticated;
create policy consents_read on public.consents for select to authenticated using ((select private.has_role('admin', 'coordinator')));

-- settings: all staff read (thresholds drive the UI), admin writes
grant select, update on public.settings to authenticated;
create policy settings_read on public.settings for select to authenticated using ((select private.is_staff()));
create policy settings_update on public.settings for update to authenticated using ((select private.has_role('admin'))) with check (true);

-- audit log: admin reads; nobody writes directly
grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated using ((select private.has_role('admin')));

-- ───────────── business rules that RLS cannot express ─────────────

-- Only an admin approves a speaker (questionnaire Q29: "איתי מאשר אותו").
create or replace function private.speaker_approval_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if (select auth.uid()) is not null and not private.has_role('admin') then
      raise exception 'only_admin_approves' using errcode = '42501';
    end if;
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;
  if new.status <> 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;
create trigger speakers_approval_guard before insert or update of status on public.speakers
  for each row execute function private.speaker_approval_guard();

-- Codes and creation metadata cannot be forged by clients.
create or replace function private.events_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.public_code := old.public_code;
    new.checkin_code := old.checkin_code;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.status = 'completed' and old.status <> 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif new.status <> 'completed' then
      new.completed_at := null;
    end if;
  else
    new.public_code := private.random_code(8);
    new.checkin_code := private.random_code(14);
    new.created_by := (select auth.uid());
    new.completed_at := case when new.status = 'completed' then now() end;
  end if;
  return new;
end $$;
create trigger events_guard before insert or update on public.events
  for each row execute function private.events_guard();

create or replace function private.participants_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.phone := case when new.phone is null then null else coalesce(private.normalize_phone(new.phone), new.phone) end;
  new.full_name := private.clean_text(new.full_name, 80);
  new.city := private.clean_text(new.city, 60);
  if tg_op = 'UPDATE' then
    new.referral_code := old.referral_code;
    new.created_via := old.created_via;
    new.created_at := old.created_at;
    if new.consent_updates and not old.consent_updates then new.consent_updates_at := now(); end if;
    if not new.consent_updates then new.consent_updates_at := null; end if;
  else
    if (select auth.uid()) is not null and current_setting('app.trusted', true) is distinct from 'on' then
      new.referral_code := private.new_participant_code();
      new.created_via := 'staff';
      new.anonymized_at := null;
    end if;
    new.consent_updates_at := case when new.consent_updates then now() end;
  end if;
  return new;
end $$;
create trigger participants_guard before insert or update on public.participants
  for each row execute function private.participants_guard();

-- Consent history: every change of a consent flag is recorded with its source and text version.
create or replace function private.consents_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('app.consent_source', true), ''), 'staff');
  v_version text := coalesce(nullif(current_setting('app.consent_version', true), ''),
                             (select s.consent_text_version from public.settings s));
begin
  if new.anonymized_at is not null then return new; end if;
  if tg_op = 'INSERT' or new.consent_updates is distinct from old.consent_updates then
    if tg_op = 'UPDATE' or new.consent_updates then
      insert into public.consents (participant_id, kind, granted, text_version, source, created_by)
      values (new.id, 'updates_whatsapp', new.consent_updates, coalesce(v_version, 'unknown'), v_source, (select auth.uid()));
    end if;
  end if;
  if tg_op = 'INSERT' or new.photo_opt_out is distinct from old.photo_opt_out then
    if tg_op = 'UPDATE' or new.photo_opt_out then
      insert into public.consents (participant_id, kind, granted, text_version, source, created_by)
      values (new.id, 'photo_opt_out', new.photo_opt_out, coalesce(v_version, 'unknown'), v_source, (select auth.uid()));
    end if;
  end if;
  return new;
end $$;
create trigger participants_consents after insert or update of consent_updates, photo_opt_out on public.participants
  for each row execute function private.consents_log();

-- Follow-ups: completion metadata is set by the server.
create or replace function private.follow_ups_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.status in ('done', 'cancelled') and (tg_op = 'INSERT' or old.status = 'open') then
    new.completed_at := now();
    new.completed_by := (select auth.uid());
  elsif new.status = 'open' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  new.title := private.clean_text(new.title, 160);
  return new;
end $$;
create trigger follow_ups_guard before insert or update on public.follow_ups
  for each row execute function private.follow_ups_guard();

-- Registrations edited directly by coordinators keep their timestamps consistent.
create or replace function private.registrations_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- identity columns and the token hash change only inside trusted server functions (merge, token issue)
    if current_setting('app.trusted', true) is distinct from 'on' then
      new.manage_token_hash := old.manage_token_hash;
      new.event_id := old.event_id;
      new.participant_id := old.participant_id;
      new.registered_at := old.registered_at;
    end if;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    elsif new.status <> 'cancelled' then
      new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
    end if;
    if new.status = 'registered' and old.status = 'waitlisted' then
      new.promoted_at := coalesce(new.promoted_at, now());
    end if;
    if new.attendance = 'attended' and old.attendance <> 'attended' then
      new.checked_in_at := coalesce(new.checked_in_at, now());
    elsif new.attendance <> 'attended' then
      new.checked_in_at := null; new.checkin_method := null; new.checked_in_by := null;
    end if;
  end if;
  return new;
end $$;
create trigger registrations_guard before update on public.registrations
  for each row execute function private.registrations_guard();
