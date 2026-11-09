-- QR check-in v2: association membership, recognising the phone at the next check-in, a request-to-join form,
-- and the thank-you message 24 hours after a meeting. See docs/07-qa-report.md §9.
-- Numbered before 20261106009000_privilege_hardening.sql, which grants anon EXECUTE on the public_* endpoints;
-- the grant for the new endpoint is repeated at the end of this file for databases where 9000 already ran.

-- ───────────── 1. membership in the association (חבר/ת עמותה) ─────────────

alter table public.participants
  add column membership text not null default 'none' check (membership in ('none', 'requested', 'member')),
  add column membership_requested_at timestamptz,
  add column member_since date check (member_since is null or member_since between date '1990-01-01' and date '2100-12-31');
create index participants_membership_idx on public.participants (membership) where membership <> 'none';

-- new ways a card can be created / a task can exist
alter table public.participants drop constraint participants_created_via_check;
alter table public.participants add constraint participants_created_via_check
  check (created_via in ('registration', 'checkin', 'staff', 'import', 'membership_form'));
alter table public.follow_ups drop constraint follow_ups_type_check;
alter table public.follow_ups add constraint follow_ups_type_check
  check (type in ('no_show', 'first_time', 'lapsed', 'waitlist', 'general', 'membership'));
create unique index follow_ups_one_open_membership on public.follow_ups (participant_id) where type = 'membership' and status = 'open';

-- membership dates follow the status: asked → when; became a member → since today (staff can correct the date)
create or replace function private.participants_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.membership = 'none' then
    new.membership_requested_at := null;
    new.member_since := null;
  elsif new.membership = 'requested' then
    new.member_since := null;
    if tg_op = 'INSERT' or old.membership <> 'requested' then
      new.membership_requested_at := coalesce(new.membership_requested_at, now());
    end if;
  elsif new.membership = 'member' then
    new.member_since := coalesce(new.member_since, private.local_today());
  end if;
  return new;
end $$;
create trigger participants_membership before insert or update of membership, member_since, membership_requested_at on public.participants
  for each row execute function private.participants_membership();

-- a request is answered by becoming a member (or by staff setting it back): the open "asked to join" task closes itself
create or replace function private.membership_task_close()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership is distinct from old.membership and new.membership <> 'requested' then
    update public.follow_ups set status = 'done',
           outcome = case when new.membership = 'member' then 'נסגר אוטומטית: סומן/ה כחבר/ת עמותה'
                          else 'נסגר אוטומטית: בקשת ההצטרפות בוטלה בכרטיס' end
    where participant_id = new.id and type = 'membership' and status = 'open';
  end if;
  return new;
end $$;
create trigger participants_membership_task after update of membership on public.participants
  for each row execute function private.membership_task_close();

-- ───────────── 2. the phone remembers who checked in from it ─────────────
-- After a check-in, the phone keeps a random device token (localStorage). Next time, "I'm here" is one tap,
-- even without registering. Only a hash is stored here; the token never appears in a URL.

create table private.participant_devices (
  token_hash bytea primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index participant_devices_participant_idx on private.participant_devices (participant_id, last_used_at desc);
alter table private.participant_devices enable row level security;   -- no policies: only the functions below reach it
revoke all on private.participant_devices from public, anon, authenticated;

create or replace function private.issue_device(p_participant_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token text := private.new_token();
begin
  -- keep the few most recent phones of a person; phones unused for 180 days are forgotten
  delete from private.participant_devices d
  where d.participant_id = p_participant_id
    and (d.last_used_at < now() - interval '180 days'
         or d.token_hash in (select x.token_hash from private.participant_devices x
                             where x.participant_id = p_participant_id order by x.last_used_at desc offset 3));
  insert into private.participant_devices (token_hash, participant_id) values (private.token_hash(v_token), p_participant_id);
  return v_token;
end $$;

create or replace function private.device_participant(p_token text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update private.participant_devices d set last_used_at = now()
  from public.participants p
  where d.token_hash = private.token_hash(p_token) and p.id = d.participant_id and p.anonymized_at is null
    and d.last_used_at > now() - interval '180 days'
  returning d.participant_id into v_id;
  return v_id;
end $$;

-- deleting someone's personal details also forgets their phones
create or replace function private.forget_devices()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    delete from private.participant_devices where participant_id = new.id;
  end if;
  return new;
end $$;
create trigger participants_forget_devices after update of anonymized_at on public.participants
  for each row execute function private.forget_devices();

-- the check-in answer now says whether the person is a member (shown on the welcome screen)
create or replace function private.checkin_result(p_reg_id uuid, p_result text, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'result', p_result,
    'first_name', private.registrant_first_name(r),
    'token', p_token,
    'photo_opt_out', pa.photo_opt_out,
    'invite_code', pa.referral_code,
    'membership', pa.membership,
    'attended_count', (select count(*) from public.registrations x where x.participant_id = pa.id and x.attendance = 'attended'),
    'friday_count', (select count(*) from public.registrations x join public.events e on e.id = x.event_id
                     where x.participant_id = pa.id and x.attendance = 'attended' and e.type = 'friday'),
    'can_undo', r.checkin_method = 'self_qr' and r.checked_in_at > now() - interval '10 minutes',
    'event', private.event_public(r.event_id))
  from public.registrations r join public.participants pa on pa.id = r.participant_id
  where r.id = p_reg_id
$$;

-- p: { code, device? | token? | phone? }
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

  -- a phone this person checked in from before: one tap, registered for this meeting or not
  if coalesce(p ->> 'device', '') <> '' then
    v_part_id := private.device_participant(p ->> 'device');
    if v_part_id is null then
      return jsonb_build_object('result', 'device_invalid');
    end if;
    select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part_id for update;
    if not found then
      insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, created_via)
      values (v_event.id, v_part_id, 'registered', 'attended', true, now(), 'self_qr', 'checkin')
      returning * into v_reg;
      v_new := true;
    else
      v_new := private.mark_attended(v_reg.id, 'self_qr');
    end if;
    v_token := private.new_token();
    perform private.set_registration_token(v_reg.id, v_token);
    return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
           || jsonb_build_object('device', p ->> 'device');
  end if;

  if coalesce(p ->> 'token', '') <> '' then
    v_reg := private.registration_by_token(p ->> 'token');
    if v_reg.id is not null and v_reg.event_id = v_event.id then
      v_new := private.mark_attended(v_reg.id, 'self_qr');
      return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, p ->> 'token')
             || jsonb_build_object('device', private.issue_device(v_reg.participant_id));
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
    -- known phone, not registered for this meeting: no name is shown; the walk-in form asks for the person's own name (R1)
    return jsonb_build_object('result', 'not_registered');
  end if;
  v_new := private.mark_attended(v_reg.id, 'self_qr');
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
         || jsonb_build_object('device', private.issue_device(v_part_id));
end $$;

-- walk-in at the door: the phone is remembered only when the typed name matches the card (or the card is new),
-- so typing someone else's number does not hand this phone their identity
select private.patch_function('public.public_walkin(jsonb)',
$o$  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token);$o$,
$n$  return private.checkin_result(v_reg.id, case when v_new then 'checked_in' else 'already_checked_in' end, v_token)
         || case when v_is_new or lower(btrim(coalesce(v_part.full_name, ''))) = lower(btrim(coalesce(r.full_name, '')))
                 then jsonb_build_object('device', private.issue_device(v_part.id)) else '{}'::jsonb end;$n$);

-- "that's not me": the phone also forgets the person it just remembered
select private.patch_function('public.public_checkin_undo(text)',
$o$  perform set_config('app.trusted', '', true);
  perform private.audit_action('checkin_undo', 'registrations', v_reg.id::text);$o$,
$n$  perform set_config('app.trusted', '', true);
  delete from private.participant_devices where participant_id = v_reg.participant_id and last_used_at > now() - interval '10 minutes';
  perform private.audit_action('checkin_undo', 'registrations', v_reg.id::text);$n$);

-- ───────────── 3. "I want to join the association" ─────────────
-- p: { device } (a phone that checked in before) | { full_name, phone }; website is a honeypot.
-- With a typed phone the answer is always the same, so the form tells nothing about who is in the system.
create or replace function public.public_membership(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pid uuid;
  v_part public.participants;
  v_known boolean := false;
  v_name text;
  v_phone text;
  v_settings public.settings;
  v_note text;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('result', 'requested');
  end if;
  perform private.rate_limit('member-ip:' || private.client_key(), 10, 3600);
  select s.* into v_settings from public.settings s;

  if coalesce(p ->> 'device', '') <> '' then
    v_pid := private.device_participant(p ->> 'device');
    if v_pid is null then
      return jsonb_build_object('result', 'device_invalid');
    end if;
    v_known := true;
  else
    v_name := private.clean_text(p ->> 'full_name', 80);
    v_phone := private.normalize_phone(p ->> 'phone');
    if v_name is null or char_length(v_name) < 2 or v_name ~ '[0-9<>@/\\{}=;]' then
      raise exception 'invalid_name' using errcode = 'P0001';
    end if;
    if v_phone is null then
      raise exception 'invalid_phone' using errcode = 'P0001';
    end if;
    perform private.rate_limit('member-phone:' || private.sha(v_phone), 3, 86400);
    select id into v_pid from public.participants where phone = v_phone;
    if v_pid is null then
      perform set_config('app.trusted', 'on', true);
      insert into public.participants (full_name, phone, created_via) values (v_name, v_phone, 'membership_form')
      returning id into v_pid;
      perform set_config('app.trusted', '', true);
    end if;
  end if;

  select * into v_part from public.participants where id = v_pid for update;
  if v_part.membership = 'none' then
    update public.participants set membership = 'requested' where id = v_pid;
    if v_name is not null and lower(btrim(v_name)) <> lower(btrim(coalesce(v_part.full_name, ''))) then
      v_note := 'השם שהוקלד בטופס: ' || v_name || '. ייתכן שהוקלד מספר טלפון של מישהו אחר, כדאי לוודא בשיחה.';
    end if;
    insert into public.follow_ups (participant_id, type, title, notes, due_date, assignee_id, created_by)
    values (v_pid, 'membership', 'ביקש/ה להצטרף לעמותה: לחזור עם פרטי ההצטרפות', v_note,
            private.local_today() + 3, v_settings.default_task_assignee, null)
    on conflict do nothing;
    perform private.audit_action('membership_request', 'participants', v_pid::text);
  end if;

  if v_known then
    return jsonb_build_object(
      'result', case v_part.membership when 'member' then 'already_member' when 'requested' then 'already_requested' else 'requested' end,
      'first_name', private.first_name(v_part.full_name));
  end if;
  return jsonb_build_object('result', 'requested');
end $$;

-- ───────────── 4. thank-you 24 hours after the meeting ─────────────
-- Nothing is sent automatically (no WhatsApp provider is connected, and every message needs a person's approval):
-- 24 hours after a meeting ends, the dashboard lists it with the number of thank-you messages still to send.
-- Members and people without consent get the thank-you; non-members who agreed to updates get the thank-you
-- with an invitation to join (a marketing message under Communications Law §30A, hence the consent).

insert into public.message_templates (key, label, audience, is_marketing, sort_order, body) values
  ('join_invite', 'תודה + הזמנה להצטרף לעמותה', 'attended', true, 35,
   '{שם_פרטי}, תודה שהיית איתנו ב{שם_המפגש}! שמחנו מאוד שהגעת.' || E'\n' ||
   'רצינו גם להזמין אותך להצטרף לעמותת המשך תנועה ולהיות חלק מהקהילה. כל הפרטים כאן: {קישור_הצטרפות}' || E'\n' ||
   'ונשמח לשמוע איך היה במפגש: {קישור_משוב}'),
  -- the reply to someone who asked to join: they asked to be contacted, so it is not a marketing message
  ('membership_reply', 'מענה לבקשת הצטרפות לעמותה', 'participant', false, 75,
   'היי {שם_פרטי}, קיבלנו את הבקשה שלך להצטרף לעמותת המשך תנועה. תודה! נשמח לספר לך על ההצטרפות. מתי נוח לך לדבר?')
on conflict (key) do nothing;

create or replace function private.aftercare_ready()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                                               'pending', x.pending, 'join_invites', x.join_invites) order by x.ends_at), '[]'::jsonb)
  from (
    select e.id, e.title, e.starts_at, e.ends_at,
           count(*)::int as pending,
           count(*) filter (where p.membership = 'none' and p.consent_updates)::int as join_invites
    from public.events e
    join public.registrations r on r.event_id = e.id and r.attendance = 'attended'
    join public.participants p on p.id = r.participant_id and p.anonymized_at is null and p.phone is not null
    where e.status <> 'cancelled' and e.ends_at <= now() - interval '24 hours' and e.ends_at > now() - interval '7 days'
      and not exists (select 1 from public.contact_log c
                      where c.participant_id = p.id and c.event_id = e.id and c.template_key in ('thanks', 'join_invite'))
    group by e.id
  ) x
$$;

select private.patch_function('public.attention_items()',
$o$    'name_mismatches', private.name_mismatches());$o$,
$n$    'name_mismatches', private.name_mismatches(),
    'aftercare', private.aftercare_ready());$n$);

-- ───────────── 5. the door list shows members and who invited whom ─────────────
create or replace function public.staff_checkin_list(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
  v_full boolean;
begin
  select * into v_event from public.events where id = p_event_id;
  perform private.assert_door_access(v_event);
  v_full := private.has_role('admin', 'coordinator');
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.status_rank, x.display_name)
    from (
      select
        r.id as registration_id,
        case when v_full then pa.id end as participant_id,
        coalesce(pa.full_name, 'פרטים נמחקו') as display_name,
        right(pa.phone, 4) as phone_last4,
        case when v_full then pa.phone end as phone,
        r.status, r.attendance, r.is_walk_in, r.checked_in_at, r.checkin_method, r.registered_at,
        pa.photo_opt_out,
        pa.membership = 'member' as is_member,
        -- who invited them, as a first name only (the door needs no more to say thank you)
        private.first_name(coalesce(rp.full_name, r.referrer_name, pp.full_name, pa.referred_by_name)) as invited_by,
        prior.attended as prior_attended,
        prior.fridays as prior_fridays,
        prior.attended = 0 as first_time,
        case r.status when 'registered' then 0 when 'waitlisted' then 1 else 2 end as status_rank,
        case when r.status = 'waitlisted' then private.waitlist_position(r.id) end as waitlist_position
      from public.registrations r
      join public.participants pa on pa.id = r.participant_id
      left join public.participants rp on rp.id = r.referrer_participant_id and rp.anonymized_at is null
      left join public.participants pp on pp.id = pa.referred_by_participant_id and pp.anonymized_at is null
      cross join lateral (
        select count(*)::int as attended,
               count(*) filter (where e2.type = 'friday')::int as fridays
        from public.registrations r2 join public.events e2 on e2.id = r2.event_id
        where r2.participant_id = r.participant_id and r2.attendance = 'attended' and e2.starts_at < v_event.starts_at
      ) prior
      where r.event_id = p_event_id
    ) x), '[]'::jsonb);
end $$;

-- ───────────── grants ─────────────
revoke execute on function private.issue_device(uuid), private.device_participant(text), private.aftercare_ready() from public, anon;
-- attention_items() runs as the signed-in user and calls this one
grant execute on function private.aftercare_ready() to authenticated;
revoke execute on function public.public_membership(jsonb) from public;
grant execute on function public.public_membership(jsonb) to anon, authenticated;
