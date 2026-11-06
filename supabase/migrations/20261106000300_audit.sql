-- Audit log for sensitive actions. Records who, when, what entity and WHICH fields changed.
-- Personal values (names, phones, notes) are never copied into the log: only the values of the
-- columns listed as trigger arguments (statuses, roles, flags) are kept in `details`.

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_details jsonb := '{}'::jsonb;
  v_col text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    join jsonb_each(v_old) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if v_changed is null then
      return new;
    end if;
  end if;

  if tg_nargs > 0 then
    foreach v_col in array tg_argv loop
      if v_row ? v_col and (tg_op <> 'UPDATE' or v_col = any (v_changed)) then
        v_details := v_details || jsonb_build_object(v_col, v_row -> v_col);
      end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changed_fields, details)
  values (
    (select auth.uid()),
    coalesce((select s.role from public.staff s where s.user_id = (select auth.uid())),
             case coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
               when 'anon' then 'public' when 'authenticated' then 'unknown' else 'system' end),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'key'),
    v_changed,
    nullif(v_details, '{}'::jsonb)
  );
  return coalesce(new, old);
end $$;

create trigger audit_participants after insert or update or delete on public.participants
  for each row execute function private.audit_row('created_via', 'consent_updates', 'photo_opt_out', 'anonymized_at');
create trigger audit_registrations after insert or update on public.registrations
  for each row execute function private.audit_row('event_id', 'status', 'attendance', 'is_walk_in', 'checkin_method', 'created_via', 'cancelled_by');
create trigger audit_events after insert or update or delete on public.events
  for each row execute function private.audit_row('type', 'status', 'starts_at', 'capacity');
create trigger audit_speakers after insert or update or delete on public.speakers
  for each row execute function private.audit_row('kind', 'status', 'source');
create trigger audit_staff after insert or update or delete on public.staff
  for each row execute function private.audit_row('role', 'is_active', 'must_change_password');
create trigger audit_settings after update on public.settings
  for each row execute function private.audit_row();
create trigger audit_templates after insert or update on public.message_templates
  for each row execute function private.audit_row('is_marketing');
create trigger audit_sources after insert or update on public.acquisition_sources
  for each row execute function private.audit_row('is_active', 'is_friend');
create trigger audit_links after insert or update on public.referral_links
  for each row execute function private.audit_row('code', 'is_active');
create trigger audit_feedback_delete after delete on public.feedback
  for each row execute function private.audit_row('event_id');
create trigger audit_contact_delete after delete on public.contact_log
  for each row execute function private.audit_row('channel');
create trigger audit_sites after insert or update on public.sites
  for each row execute function private.audit_row('is_active');

-- Explicit audit entries for actions that are not a single row change (exports, merges, anonymization).
create or replace function private.audit_action(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, details)
  values ((select auth.uid()), (select s.role from public.staff s where s.user_id = (select auth.uid())),
          p_action, p_entity, p_entity_id, p_details)
$$;

-- Called by the app whenever a report or list is exported to CSV.
create or replace function public.log_export(p_kind text, p_rows int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('admin', 'coordinator') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('participants', 'events', 'sources', 'presenters', 'monthly', 'followups', 'event_registrations', 'referrers', 'links') then
    raise exception 'invalid_kind';
  end if;
  if p_kind in ('participants', 'event_registrations') and not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.audit_action('export', p_kind, null, jsonb_build_object('rows', greatest(0, least(p_rows, 1000000))));
end $$;
grant execute on function public.log_export(text, int) to authenticated;
