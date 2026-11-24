-- No confirmed place without payment (24.11.2026). The owner: "אני רוצה לא תהיה אופציה להרשם לימי שישי בלי לשלם. תעביר
-- אותם תהליך שלא יהיה סיכוי שמישהו הצליח להרשם אבל דילג על התשלום".
--
-- THE RULE, enforced by the database for every path (functions, the API, a coordinator's direct table access):
--   at a meeting with a fee (events.price > 0) a registration becomes 'registered', or is marked as arrived
--   ('attended'), only when its payment_status is 'paid' or 'waived'.
--   'paid'    comes only from private.write_payment(), reached from: the provider webhook (mark_paid_by_provider, method
--             card, the document number as reference), staff_confirm_payment / staff_set_payment / staff_attach_payment
--             (admin, coordinator: amount, method, reference), and the door's cash (staff_door_payment and the new
--             p_cash of the door check-in functions: method cash, the meeting's price). Every change of payment_status,
--             paid_amount and payment_method is in audit_log with who (actor_id, actor_role) and when.
--   'waived'  the existing "פטור מתשלום" (staff_set_payment, admin and coordinator), now with a required reason.
-- Free meetings are not affected. Rows that are already 'registered' without payment (from before pay-first) are not
-- touched by this migration: the rule applies when a row BECOMES registered or arrived, or when a confirmed row loses its
-- payment. The read-only query in supabase/repair/pay_guarantee_unpaid_registered.sql lists them for the team.
--
--   registrations_settled   the trigger that enforces the rule (raises 'payment_required')
--   events_payment_rules    a meeting with a fee opens for registration only with a payment link
--                           ('payment_link_required'); a price is not added to a meeting that already has confirmed,
--                           unpaid registrations ('price_has_registrations')
--   public_register         every meeting with a fee is pay-first (was: only with a link); a cancelled registration that
--                           was paid is registered again without paying twice
--   self check-in           (QR, saved phone, personal link, site sign, walk-in form) an unpaid person at a meeting with a
--                           fee gets 'payment_required' (the meeting's payment link, or cash to the team at the entrance);
--                           someone not registered gets a pending-payment registration, so a payment by link finds it
--   door (staff)            staff_set_attendance / staff_checkin_existing / staff_add_walkin take p_cash: arrival of an
--                           unpaid person is recorded only together with the cash, in one transaction; undoing a cash mark
--                           (staff_door_payment p_paid=false) also takes the arrival and the place back
--   staff_register          at a meeting with a fee: 'pending_payment' (or the waitlist when full), not 'registered'
--   staff_promote           an unpaid waitlisted row at a meeting with a fee goes to 'pending_payment' (the personal link
--                           pays), a paid one is registered as before
--   staff_set_payment       "waived" needs a reason; "not paid" on a confirmed place moves it back to 'pending_payment'
--                           (an arrived one cannot be un-paid: 'already_attended'); a refund of a confirmed place that did
--                           not arrive needs a cancellation first ('cancel_first')
--   staff_merge_participants keeps the paid registration (and its payment) when both cards were registered
--   the webhook             a pending registration is matched only at a meeting paid through the link
--   message template        'payment_due': "התפנה מקום" with the personal link to pay
--
-- Numbered before 20261106009000_privilege_hardening.sql; the grants are repeated below for databases where it ran.
-- Written to be re-applied safely (drop … if exists, create or replace, on conflict do nothing).

-- ───────────── the rule ─────────────

create or replace function private.payment_settled(p_payment_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_payment_status in ('paid', 'waived')
$$;

-- Fires after registrations_payment (triggers of one kind run in name order: "payment" < "settled"), so it sees the
-- payment columns as they will be stored.
create or replace function private.registrations_paid_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_price numeric;
begin
  if private.payment_settled(new.payment_status) then
    return new;
  end if;
  if not (
       -- becomes a confirmed place
       (new.status = 'registered' and (tg_op = 'INSERT' or old.status is distinct from 'registered'))
       -- becomes "arrived" (every check-in path)
    or (new.attendance = 'attended' and (tg_op = 'INSERT' or old.attendance is distinct from 'attended'))
       -- a confirmed place loses its payment (a refund after arriving is the one exception: the meeting took place)
    or (tg_op = 'UPDATE' and new.status = 'registered' and private.payment_settled(old.payment_status)
        and not (new.payment_status = 'refunded' and old.attendance = 'attended'))
  ) then
    return new;
  end if;
  select price into v_price from public.events where id = new.event_id;
  if coalesce(v_price, 0) > 0 then
    raise exception 'payment_required' using errcode = 'P0001',
      detail = 'At a meeting with a fee a registration is confirmed (or checked in) only when it is paid or waived.';
  end if;
  return new;
end $$;

drop trigger if exists registrations_settled on public.registrations;
create trigger registrations_settled before insert or update on public.registrations
  for each row execute function private.registrations_paid_guard();

-- A meeting with a fee: open for registration only with a payment link (otherwise nobody could pay before coming: such a
-- meeting stays a draft, or "registration closed" and pays at the entrance). Checked only when the status, the price or the
-- link change, so other edits of an older meeting keep working. And no price on a meeting with confirmed unpaid places.
create or replace function private.events_payment_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.price, 0) > 0 and new.payment_url is null and new.status = 'open'
     and (tg_op = 'INSERT' or new.status is distinct from old.status or new.price is distinct from old.price
          or new.payment_url is distinct from old.payment_url) then
    raise exception 'payment_link_required' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and coalesce(old.price, 0) <= 0 and coalesce(new.price, 0) > 0
     and exists (select 1 from public.registrations r
                 where r.event_id = new.id and r.status = 'registered' and not private.payment_settled(r.payment_status)) then
    raise exception 'price_has_registrations' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists events_payment_rules on public.events;
create trigger events_payment_rules before insert or update on public.events
  for each row execute function private.events_payment_rules();

-- ───────────── registering ─────────────

-- every meeting with a fee is pay-first; a cancelled registration that was already paid (or waived) comes back registered
select private.patch_function('public.public_register(jsonb)',
$o$  v_pay_first := coalesce(v_event.price, 0) > 0 and v_event.payment_url is not null;$o$,
$n$  v_pay_first := coalesce(v_event.price, 0) > 0;$n$);
select private.patch_function('public.public_register(jsonb)',
$o$    v_status := case when v_pay_first then 'pending_payment' else 'registered' end;$o$,
$n$    v_status := case when v_pay_first and not (v_has_existing and private.payment_settled(v_existing.payment_status))
                     then 'pending_payment' else 'registered' end;$n$);

-- the webhook: a pending registration is matched only at a meeting paid through the provider's link (a receipt for
-- something else, a donation or a membership fee, never pays a place at a meeting that collects at the entrance)
select private.patch_function('private.yesh_payment(jsonb)',
$o$      and e.status in ('open', 'closed') and e.ends_at > now() and coalesce(e.price, 0) > 0 and e.price <= v_amount
    order by r.registered_at desc$o$,
$n$      and e.status in ('open', 'closed') and e.ends_at > now() and coalesce(e.price, 0) > 0 and e.price <= v_amount
      and e.payment_url is not null
    order by r.registered_at desc$n$);

-- Register an existing participant from the office. At a meeting with a fee the place waits for the payment (the team
-- confirms it, "אישור תשלום", or sends the personal link to pay); a full meeting puts them on the waitlist as before.
CREATE OR REPLACE FUNCTION public.staff_register(p_event_id uuid, p_participant_id uuid, p_over_capacity boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_reg public.registrations;
  v_found boolean;
  v_count int;
  v_full boolean;
  v_status text;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_event.status in ('cancelled', 'completed') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.participants where id = p_participant_id and anonymized_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = p_participant_id for update;
  v_found := found;
  if v_found and v_reg.status not in ('cancelled', 'pending_payment') then
    raise exception 'already_registered' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.registrations where event_id = p_event_id and status = 'registered';
  v_full := v_event.capacity is not null and v_count >= v_event.capacity and not p_over_capacity;
  v_status := case
    when v_full then 'waitlisted'
    when coalesce(v_event.price, 0) > 0 and not (v_found and private.payment_settled(v_reg.payment_status)) then 'pending_payment'
    else 'registered' end;
  if v_found then
    perform set_config('app.trusted', 'on', true);
    update public.registrations set status = v_status, registered_at = now(), attendance = 'unknown' where id = v_reg.id;
    perform set_config('app.trusted', '', true);
  else
    insert into public.registrations (event_id, participant_id, status, created_via)
    values (p_event_id, p_participant_id, v_status, 'staff')
    returning * into v_reg;
  end if;
  return jsonb_build_object('registration_id', v_reg.id, 'status', v_status);
end $function$;

-- Promote from the waitlist. At a meeting with a fee an unpaid row is not registered: it waits for the payment
-- ('pending_payment', registered_at now so the webhook matches it for the next 14 days), and the team sends the personal
-- link (template 'payment_due'). A row already paid (paid after the places ran out) is registered as before.
CREATE OR REPLACE FUNCTION public.staff_promote(p_registration_id uuid, p_over_capacity boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_event public.events;
  v_count int;
  v_status text;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_reg from public.registrations where id = p_registration_id;
  if not found or v_reg.status <> 'waitlisted' then
    raise exception 'not_waitlisted' using errcode = 'P0001';
  end if;
  -- the meeting first, then the registration (the order public_register and the payments use)
  v_reg := private.lock_registration(p_registration_id);
  if v_reg.status <> 'waitlisted' then
    raise exception 'not_waitlisted' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.status in ('cancelled', 'completed', 'draft') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is not null and v_count >= v_event.capacity and not p_over_capacity then
    raise exception 'event_full' using errcode = 'P0001';
  end if;
  if coalesce(v_event.price, 0) > 0 and not private.payment_settled(v_reg.payment_status) then
    v_status := 'pending_payment';
    perform set_config('app.trusted', 'on', true);
    update public.registrations set status = 'pending_payment', registered_at = now() where id = v_reg.id;
    perform set_config('app.trusted', '', true);
  else
    v_status := 'registered';
    update public.registrations set status = 'registered', promoted_at = now() where id = v_reg.id;
  end if;
  return jsonb_build_object('registration_id', v_reg.id, 'status', v_status);
end $function$;

insert into public.message_templates (key, label, body, audience, is_marketing, sort_order)
values ('payment_due', 'התפנה מקום: נשאר לשלם',
'היי {שם_פרטי}, התפנה מקום ב{שם_המפגש} ב{תאריך} ב-{שעה}.
המקום נשמר אחרי התשלום, בקישור האישי:
{קישור_אישי}
אם כבר לא מתאים לך להגיע, אפשר לבטל באותו קישור.',
'waitlisted', false, 52)
on conflict (key) do nothing;

-- ───────────── self check-in ─────────────

-- Arrival by the person themselves: false when already in, null when the meeting has a fee and the registration is not
-- paid (the caller answers 'payment_required' and changes nothing), true when marked now.
CREATE OR REPLACE FUNCTION private.mark_attended(p_reg_id uuid, p_method text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_price numeric;
begin
  select * into v_reg from public.registrations where id = p_reg_id for update;
  if v_reg.attendance = 'attended' then
    return false;
  end if;
  select price into v_price from public.events where id = v_reg.event_id;
  if coalesce(v_price, 0) > 0 and not private.payment_settled(v_reg.payment_status) then
    if v_reg.status = 'cancelled' then
      -- came after all: the registration waits for the payment again, so a payment by the link finds it
      perform set_config('app.trusted', 'on', true);
      update public.registrations set status = 'pending_payment', registered_at = now() where id = p_reg_id;
      perform set_config('app.trusted', '', true);
    end if;
    return null;
  end if;
  update public.registrations set status = 'registered', attendance = 'attended', checked_in_at = now(),
         checkin_method = p_method, checked_in_by = (select auth.uid())
  where id = p_reg_id;
  return true;
end $function$;

create or replace function private.checkin_outcome(p_new boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_new is null then 'payment_required' when p_new then 'checked_in' else 'already_checked_in' end
$$;

-- The self check-in answer. For 'payment_required' also whether the meeting's payment link can pay this registration
-- (the webhook matches a registration waiting for the payment, or a registered place that owes it): otherwise the page
-- sends the person to the team at the entrance.
create or replace function private.self_checkin_answer(p_reg_id uuid, p_new boolean, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.checkin_result(p_reg_id, private.checkin_outcome(p_new), p_token)
         || case when p_new is null then jsonb_build_object('can_pay_online', exists (
              select 1 from public.registrations r join public.events e on e.id = r.event_id
              where r.id = p_reg_id and e.payment_url is not null and r.status in ('pending_payment', 'registered')))
            else '{}'::jsonb end
$$;

-- Someone not registered checks in by themselves. A free meeting: in, as a walk-in. A meeting with a fee: a registration
-- that waits for the payment (no place, not on the door list); paying by the meeting's link confirms it through the
-- webhook, or the team takes cash at the entrance. Returns the registration.
create or replace function private.self_walkin(p_event_id uuid, p_participant_id uuid, p_source_id uuid default null,
                                               p_detail text default null, p_ref_id uuid default null, p_ref_name text default null)
returns public.registrations language plpgsql volatile security definer set search_path = '' as $$
declare
  v_priced boolean;
  v_reg public.registrations;
begin
  select coalesce(price, 0) > 0 into v_priced from public.events where id = p_event_id;
  insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method,
                                    how_heard_source_id, how_heard_detail, referrer_participant_id, referrer_name, created_via)
  values (p_event_id, p_participant_id,
          case when v_priced then 'pending_payment' else 'registered' end,
          case when v_priced then 'unknown' else 'attended' end,
          not v_priced,
          case when not v_priced then now() end,
          case when not v_priced then 'self_qr' end,
          p_source_id, p_detail, p_ref_id, p_ref_name, 'checkin')
  returning * into v_reg;
  return v_reg;
end $$;

CREATE OR REPLACE FUNCTION public.public_checkin(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      v_reg := private.self_walkin(v_event.id, v_part_id);
      v_new := case when v_reg.status = 'pending_payment' then null else true end;
    else
      v_new := private.mark_attended(v_reg.id, 'self_qr');
    end if;
    v_token := private.new_token();
    perform private.set_registration_token(v_reg.id, v_token);
    return private.self_checkin_answer(v_reg.id, v_new, v_token)
           || jsonb_build_object('device', p ->> 'device');
  end if;

  if coalesce(p ->> 'token', '') <> '' then
    v_reg := private.registration_by_token(p ->> 'token');
    if v_reg.id is not null and v_reg.event_id = v_event.id then
      v_new := private.mark_attended(v_reg.id, 'self_qr');
      return private.self_checkin_answer(v_reg.id, v_new, p ->> 'token')
             || case when v_reg.submitted_name is null
                     then jsonb_build_object('device', private.issue_device(v_reg.participant_id)) else '{}'::jsonb end;
    end if;
    if coalesce(p ->> 'phone', '') = '' then
      return jsonb_build_object('result', 'token_invalid');
    end if;
  end if;

  v_phone := private.normalize_phone(p ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  -- A phone number alone is not proof of who is holding the phone: the next step asks for the full name
  -- (public_checkin_known), the same answer for every number, registered or not.
  return jsonb_build_object('result', 'not_registered');
end $function$;

CREATE OR REPLACE FUNCTION public.public_checkin_known(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  w record;
  v_phone text;
  v_name text;
  v_part public.participants;
  v_reg public.registrations;
  v_token text;
  v_new boolean;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('result', 'need_details');
  end if;
  perform private.rate_limit('known-ip:' || private.client_key(), 30, 600);
  select * into v_event from public.events where checkin_code = btrim(coalesce(p ->> 'code', '')) for update;
  if not found then
    raise exception 'checkin_not_found' using errcode = 'P0001';
  end if;
  select * into w from private.checkin_window(v_event);
  if w.state <> 'open' then
    return jsonb_build_object('result', 'window_' || w.state, 'opens_at', w.opens_at);
  end if;
  v_phone := private.normalize_phone(p ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  v_name := private.clean_text(p ->> 'full_name', 80);
  if v_name is null or char_length(v_name) < 2 or v_name ~ '[0-9<>@/\\{}=;]' then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  -- a few name attempts per phone per day: guessing who a number belongs to is not practical
  perform private.rate_limit('known-phone:' || private.sha(v_phone), 5, 86400);

  select * into v_part from public.participants where phone = v_phone and anonymized_at is null;
  if not found or not private.same_name(v_part.full_name, v_name) then
    return jsonb_build_object('result', 'need_details');
  end if;

  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  if not found then
    v_reg := private.self_walkin(v_event.id, v_part.id);
    v_new := case when v_reg.status = 'pending_payment' then null else true end;
  else
    v_new := private.mark_attended(v_reg.id, 'self_qr');
  end if;
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.self_checkin_answer(v_reg.id, v_new, v_token)
         || jsonb_build_object('device', private.issue_device(v_part.id));
end $function$;

CREATE OR REPLACE FUNCTION public.public_walkin(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  w record;
  r private.person_input;
  v_settings public.settings;
  v_part public.participants;
  v_pid uuid;
  v_is_new boolean;
  v_reg public.registrations;
  v_ref_id uuid;
  v_ref_name text;
  v_link_id uuid;
  v_token text;
  v_new boolean;
  v_proven boolean;
  v_had_reg boolean;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('result', 'checked_in', 'first_name', private.first_name(p ->> 'full_name'));
  end if;
  perform private.rate_limit('walkin-ip:' || private.client_key(), 15, 600);
  select * into v_event from public.events where checkin_code = btrim(coalesce(p ->> 'code', '')) for update;
  if not found then
    raise exception 'checkin_not_found' using errcode = 'P0001';
  end if;
  select * into w from private.checkin_window(v_event);
  if w.state <> 'open' then
    return jsonb_build_object('result', 'window_' || w.state, 'opens_at', w.opens_at);
  end if;
  r := private.parse_person(p, true);
  select s.* into v_settings from public.settings s;
  perform set_config('app.consent_source', 'checkin_form', true);
  perform set_config('app.consent_version', v_settings.consent_text_version, true);
  select x.link_id, x.referrer_id, x.referrer_name into v_link_id, v_ref_id, v_ref_name
  from private.resolve_referrer(null, case when r.source_is_friend then r.referrer_text end, r.phone) x;
  select x.participant_id, x.is_new into v_pid, v_is_new
  from private.upsert_participant(r, 'checkin', v_ref_id, v_ref_name) x;
  select * into v_part from public.participants where id = v_pid;
  v_proven := v_is_new or private.same_name(v_part.full_name, r.full_name);

  select * into v_reg from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  v_had_reg := found;
  if not found then
    v_reg := private.self_walkin(v_event.id, v_part.id, r.source_id, r.source_detail, v_ref_id, v_ref_name);
    v_new := case when v_reg.status = 'pending_payment' then null else true end;
  else
    v_new := private.mark_attended(v_reg.id, 'self_qr');
  end if;
  perform private.note_submitted_name(v_reg.id, r.full_name);
  if v_had_reg and not v_proven then
    -- the registration of the person on the card: attendance is noted for staff, but its link is not replaced or handed out
    return private.self_checkin_answer(v_reg.id, v_new, null);
  end if;
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  return private.self_checkin_answer(v_reg.id, v_new, v_token)
         || case when v_proven then jsonb_build_object('device', private.issue_device(v_part.id)) else '{}'::jsonb end;
end $function$;

-- ───────────── the door (staff) ─────────────

-- Marks one registration as arrived, from the door or the office. At a meeting with a fee an unpaid person is let in only
-- together with the cash taken at the entrance (p_cash: the meeting's price, method cash, recorded now and audited);
-- without it, 'payment_required'. Returns whether cash was recorded now. The caller has checked access.
create or replace function private.door_checkin(p_reg_id uuid, p_cash boolean)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_price numeric;
  v_cash boolean := false;
begin
  select * into v_reg from public.registrations where id = p_reg_id for update;
  select price into v_price from public.events where id = v_reg.event_id;
  if coalesce(v_price, 0) > 0 and not private.payment_settled(v_reg.payment_status) then
    if coalesce(p_cash, false) then
      perform private.write_payment(v_reg.id, 'paid', v_price, now(), 'cash', null);
      v_cash := true;
    elsif v_reg.attendance <> 'attended' then
      raise exception 'payment_required' using errcode = 'P0001';
    end if;
  end if;
  update public.registrations set status = 'registered', attendance = 'attended',
         checked_in_at = coalesce(checked_in_at, now()), checkin_method = coalesce(checkin_method, 'staff'),
         checked_in_by = coalesce(checked_in_by, (select auth.uid()))
  where id = p_reg_id;
  return v_cash;
end $$;

drop function if exists public.staff_set_attendance(uuid, text);
create or replace function public.staff_set_attendance(p_registration_id uuid, p_attendance text, p_cash boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_cash boolean := false;
begin
  if p_attendance not in ('attended', 'no_show', 'unknown') then
    raise exception 'invalid_attendance' using errcode = 'P0001';
  end if;
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if p_attendance = 'attended' then
    v_cash := private.door_checkin(v_reg.id, p_cash);
  else
    update public.registrations set attendance = p_attendance where id = v_reg.id;
  end if;
  return jsonb_build_object('registration_id', v_reg.id, 'attendance', p_attendance, 'cash_recorded', v_cash);
end $$;

drop function if exists public.staff_checkin_existing(uuid, uuid);
create or replace function public.staff_checkin_existing(p_event_id uuid, p_participant_id uuid, p_cash boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg public.registrations;
  v_cash boolean;
begin
  select * into v_event from public.events where id = p_event_id for update;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.participants where id = p_participant_id and anonymized_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = p_participant_id for update;
  if found then
    v_cash := private.door_checkin(v_reg.id, p_cash);
  elsif coalesce(v_event.price, 0) > 0 then
    -- created waiting for the payment, then checked in together with the cash, in this one transaction
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, created_via)
    values (p_event_id, p_participant_id, 'pending_payment', 'unknown', true, 'walk_in_staff')
    returning * into v_reg;
    v_cash := private.door_checkin(v_reg.id, p_cash);
  else
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method, checked_in_by, created_via)
    values (p_event_id, p_participant_id, 'registered', 'attended', true, now(), 'staff', (select auth.uid()), 'walk_in_staff')
    returning * into v_reg;
    v_cash := false;
  end if;
  return jsonb_build_object('registration_id', v_reg.id, 'cash_recorded', v_cash);
end $$;

drop function if exists public.staff_add_walkin(uuid, jsonb);
create or replace function public.staff_add_walkin(p_event_id uuid, p jsonb, p_cash boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events;
  r private.person_input;
  v_pid uuid;
  v_is_new boolean;
  v_reg public.registrations;
  v_found boolean;
  v_ref_id uuid;
  v_ref_name text;
  v_link_id uuid;
  v_cash boolean;
begin
  select * into v_event from public.events where id = p_event_id for update;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  r := private.parse_person(p, false);
  perform set_config('app.trusted', 'on', true);
  perform set_config('app.consent_source', 'staff', true);
  select x.link_id, x.referrer_id, x.referrer_name into v_link_id, v_ref_id, v_ref_name
  from private.resolve_referrer(null, case when r.source_is_friend then r.referrer_text end, r.phone) x;
  select x.participant_id, x.is_new into v_pid, v_is_new
  from private.upsert_participant(r, 'checkin', v_ref_id, v_ref_name) x;

  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = v_pid for update;
  v_found := found;
  if v_found then
    v_cash := private.door_checkin(v_reg.id, p_cash);
  elsif coalesce(v_event.price, 0) > 0 then
    -- created waiting for the payment, then checked in together with the cash, in this one transaction
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, how_heard_source_id, how_heard_detail,
                                      referrer_participant_id, referrer_name, created_via)
    values (p_event_id, v_pid, 'pending_payment', 'unknown', true, r.source_id, r.source_detail, v_ref_id, v_ref_name, 'walk_in_staff')
    returning * into v_reg;
    v_cash := private.door_checkin(v_reg.id, p_cash);
  else
    insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, checked_in_at, checkin_method,
                                      checked_in_by, how_heard_source_id, how_heard_detail, referrer_participant_id, referrer_name, created_via)
    values (p_event_id, v_pid, 'registered', 'attended', true, now(), 'staff', (select auth.uid()),
            r.source_id, r.source_detail, v_ref_id, v_ref_name, 'walk_in_staff')
    returning * into v_reg;
    v_cash := false;
  end if;
  perform private.note_submitted_name(v_reg.id, r.full_name);
  perform set_config('app.trusted', '', true);
  return jsonb_build_object('registration_id', v_reg.id, 'participant_is_new', v_is_new, 'cash_recorded', v_cash,
                            'card_name', (select case when lower(btrim(p.full_name)) <> lower(btrim(r.full_name)) then p.full_name end
                                          from public.participants p where p.id = v_pid),
                            'already_registered', v_found and (v_reg.created_via <> 'walk_in_staff' or not v_reg.is_walk_in));
end $$;

-- The door's cash (20261106002700), and its undo: a wrong tap within 15 minutes takes the payment back, and with it the
-- arrival and the place (nobody stays registered or arrived without payment); the registration waits for the payment.
CREATE OR REPLACE FUNCTION public.staff_door_payment(p_registration_id uuid, p_paid boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_event public.events;
begin
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  perform private.assert_door_access(v_event);
  if v_event.status in ('draft', 'cancelled') then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if coalesce(v_event.price, 0) <= 0 then
    raise exception 'not_priced' using errcode = 'P0001';
  end if;
  if p_paid then
    if v_reg.payment_status = 'paid' then
      return jsonb_build_object('registration_id', v_reg.id, 'payment_status', 'paid', 'already', true);
    end if;
    if v_reg.status in ('cancelled', 'pending_payment') or v_reg.payment_status not in ('pending', 'none') then
      raise exception 'payment_not_pending' using errcode = 'P0001';
    end if;
    return private.write_payment(v_reg.id, 'paid', v_event.price, now(), 'cash', null);
  end if;
  if v_reg.payment_status <> 'paid' or v_reg.payment_method is distinct from 'cash' or v_reg.payment_ref is not null
     or v_reg.paid_at < now() - interval '15 minutes' then
    raise exception 'too_late' using errcode = 'P0001';
  end if;
  if v_reg.status = 'registered' or v_reg.attendance = 'attended' then
    update public.registrations set status = 'pending_payment', attendance = 'unknown' where id = v_reg.id;
  end if;
  return private.write_payment(v_reg.id, 'pending', null, null, null, null)
         || jsonb_build_object('status', (select status from public.registrations where id = v_reg.id));
end $function$;

-- ───────────── staff payment marks ─────────────

-- As in 20261106002700, plus: a waiver needs its reason (kept in payment_ref, the change itself in audit_log); "not paid"
-- on a confirmed place sends it back to waiting for the payment (not for someone who already arrived); a refund of a
-- confirmed place that did not take place needs the cancellation first.
CREATE OR REPLACE FUNCTION public.staff_set_payment(p_registration_id uuid, p_status text, p_amount numeric DEFAULT NULL::numeric, p_method text DEFAULT NULL::text, p_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_price numeric;
  v_amount numeric;
  v_ref text := private.clean_text(p_ref, 100);
  v_out jsonb;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_status is null or p_status not in ('none', 'pending', 'paid', 'waived', 'refunded') then
    raise exception 'invalid_payment_status' using errcode = 'P0001';
  end if;
  if p_method is not null and p_method not in ('card', 'bit', 'paybox', 'cash', 'transfer', 'other') then
    raise exception 'invalid_payment_method' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 100000 or p_amount <> round(p_amount, 2)) then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  v_reg := private.lock_registration(p_registration_id);
  if v_reg.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select price into v_price from public.events where id = v_reg.event_id;

  if p_status = 'paid' then
    v_amount := coalesce(p_amount, nullif(v_price, 0));
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_amount' using errcode = 'P0001';
    end if;
    v_out := private.write_payment(v_reg.id, 'paid', v_amount,
                                   case when v_reg.payment_status = 'paid' then v_reg.paid_at else now() end,
                                   coalesce(p_method, 'other'), v_ref);
  elsif p_status = 'waived' then
    if v_ref is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_out := private.write_payment(v_reg.id, 'waived', null, null, null, v_ref);
  elsif p_status = 'refunded' then
    if v_reg.payment_status not in ('paid', 'refunded') then
      raise exception 'not_paid' using errcode = 'P0001';
    end if;
    if coalesce(v_price, 0) > 0 and v_reg.status = 'registered' and v_reg.attendance <> 'attended' then
      raise exception 'cancel_first' using errcode = 'P0001';
    end if;
    return private.write_payment(v_reg.id, 'refunded', coalesce(p_amount, v_reg.paid_amount), v_reg.paid_at,
                                 v_reg.payment_method, coalesce(v_ref, v_reg.payment_ref));
  else
    -- 'pending' or 'none': the payment is taken back
    if coalesce(v_price, 0) > 0 and v_reg.status = 'registered' and private.payment_settled(v_reg.payment_status) then
      if v_reg.attendance = 'attended' then
        raise exception 'already_attended' using errcode = 'P0001';
      end if;
      update public.registrations set status = 'pending_payment' where id = v_reg.id;
      return private.write_payment(v_reg.id, p_status, null, null, null, null) || jsonb_build_object('status', 'pending_payment');
    end if;
    return private.write_payment(v_reg.id, p_status, null, null, null, null);
  end if;
  if v_reg.status = 'pending_payment' then
    v_out := v_out || jsonb_build_object('status', private.place_paid_registration(v_reg.id));
  end if;
  return v_out;
end $function$;

-- ───────────── merging two cards ─────────────

-- As in 20261106000500, except when both cards are registered to the same meeting: the better registration is kept
-- whole (arrived > registered > waiting for payment > waitlisted > cancelled, then the paid one), moved to the kept card,
-- and a payment on the other one is carried over when the kept one has none. No status is copied without its payment.
CREATE OR REPLACE FUNCTION public.staff_merge_participants(p_keep uuid, p_merge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k public.participants;
  m public.participants;
  rm record;
  v_keep_reg public.registrations;
  v_win public.registrations;
  v_lose public.registrations;
  v_moved int := 0;
  v_prev text;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_keep = p_merge then
    raise exception 'same_participant' using errcode = 'P0001';
  end if;
  select * into k from public.participants where id = p_keep for update;
  select * into m from public.participants where id = p_merge for update;
  if k.id is null or m.id is null or k.anonymized_at is not null or m.anonymized_at is not null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform set_config('app.trusted', 'on', true);

  for rm in select * from public.registrations where participant_id = p_merge loop
    select * into v_keep_reg from public.registrations where participant_id = p_keep and event_id = rm.event_id for update;
    if v_keep_reg.id is null then
      update public.registrations set participant_id = p_keep,
             referrer_participant_id = nullif(referrer_participant_id, p_keep)
      where id = rm.id;
    else
      if private.merge_rank(rm.status, rm.attendance, rm.payment_status)
         > private.merge_rank(v_keep_reg.status, v_keep_reg.attendance, v_keep_reg.payment_status) then
        select * into v_win from public.registrations where id = rm.id;
        v_lose := v_keep_reg;
      else
        v_win := v_keep_reg;
        select * into v_lose from public.registrations where id = rm.id;
      end if;
      -- money on the other registration is not lost
      if v_win.payment_status in ('none', 'pending')
         and (private.payment_settled(v_lose.payment_status) or (v_lose.payment_status = 'refunded' and v_win.status <> 'registered')) then
        perform private.write_payment(v_win.id, v_lose.payment_status, v_lose.paid_amount, v_lose.paid_at,
                                      v_lose.payment_method, v_lose.payment_ref);
      end if;
      update public.feedback set registration_id = v_win.id
      where registration_id = v_lose.id and not exists (select 1 from public.feedback f where f.registration_id = v_win.id);
      delete from public.registrations where id = v_lose.id;
      if v_win.id = rm.id then
        update public.registrations set participant_id = p_keep,
               referrer_participant_id = nullif(referrer_participant_id, p_keep)
        where id = rm.id;
      end if;
      if v_win.status = 'pending_payment'
         and private.payment_settled((select payment_status from public.registrations where id = v_win.id)) then
        perform private.place_paid_registration(v_win.id);
      end if;
    end if;
    v_keep_reg := null;
    v_moved := v_moved + 1;
  end loop;

  update public.feedback set participant_id = p_keep where participant_id = p_merge;
  delete from public.follow_ups f where f.participant_id = p_merge and (
    (f.event_id is not null and exists (select 1 from public.follow_ups g where g.participant_id = p_keep and g.event_id = f.event_id and g.type = f.type))
    or (f.type = 'lapsed' and f.status = 'open' and exists (select 1 from public.follow_ups g where g.participant_id = p_keep and g.type = 'lapsed' and g.status = 'open')));
  update public.follow_ups set participant_id = p_keep where participant_id = p_merge;
  update public.contact_log set participant_id = p_keep where participant_id = p_merge;
  update public.consents set participant_id = p_keep where participant_id = p_merge;
  update public.participants set referred_by_participant_id = case when id = p_keep then null else p_keep end
  where referred_by_participant_id = p_merge;
  update public.registrations set referrer_participant_id = case when participant_id = p_keep then null else p_keep end
  where referrer_participant_id = p_merge;

  update public.participants set
    city = coalesce(city, m.city),
    birth_year = coalesce(birth_year, m.birth_year),
    birth_date = coalesce(birth_date, m.birth_date),
    occupation = coalesce(occupation, m.occupation),
    first_source_id = coalesce(first_source_id, m.first_source_id),
    first_source_detail = coalesce(first_source_detail, m.first_source_detail),
    referred_by_participant_id = coalesce(referred_by_participant_id, nullif(m.referred_by_participant_id, p_keep)),
    referred_by_name = coalesce(referred_by_name, m.referred_by_name),
    photo_opt_out = photo_opt_out or m.photo_opt_out,
    notes = left(nullif(concat_ws(E'\n', notes, m.notes), ''), 1000)
  where id = p_keep;

  delete from public.participants where id = p_merge;
  perform set_config('app.trusted', '', true);
  perform private.audit_action('merge', 'participants', p_keep::text, jsonb_build_object('merged_id', p_merge, 'registrations', v_moved));
  return jsonb_build_object('kept', p_keep, 'registrations_moved', v_moved);
end $function$;

create or replace function private.merge_rank(p_status text, p_attendance text, p_payment text)
returns int language sql immutable set search_path = '' as $$
  select (case when p_attendance = 'attended' then 5 when p_status = 'registered' then 4 when p_status = 'pending_payment' then 3
               when p_status = 'waitlisted' then 2 else 1 end) * 2
         + case when p_payment in ('paid', 'waived') then 1 else 0 end
$$;

-- ───────────── grants ─────────────

revoke execute on function private.payment_settled(text) from public, anon, authenticated;
revoke execute on function private.registrations_paid_guard() from public, anon, authenticated;
revoke execute on function private.events_payment_rules() from public, anon, authenticated;
revoke execute on function private.checkin_outcome(boolean) from public, anon, authenticated;
revoke execute on function private.self_checkin_answer(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function private.self_walkin(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function private.door_checkin(uuid, boolean) from public, anon, authenticated;
revoke execute on function private.merge_rank(text, text, text) from public, anon, authenticated;
revoke execute on function private.mark_attended(uuid, text) from public, anon, authenticated;

revoke execute on function public.staff_set_attendance(uuid, text, boolean) from public, anon;
revoke execute on function public.staff_checkin_existing(uuid, uuid, boolean) from public, anon;
revoke execute on function public.staff_add_walkin(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.staff_register(uuid, uuid, boolean) from public, anon;
revoke execute on function public.staff_promote(uuid, boolean) from public, anon;
revoke execute on function public.staff_door_payment(uuid, boolean) from public, anon;
revoke execute on function public.staff_set_payment(uuid, text, numeric, text, text) from public, anon;
revoke execute on function public.staff_merge_participants(uuid, uuid) from public, anon;
grant execute on function public.staff_set_attendance(uuid, text, boolean) to authenticated;
grant execute on function public.staff_checkin_existing(uuid, uuid, boolean) to authenticated;
grant execute on function public.staff_add_walkin(uuid, jsonb, boolean) to authenticated;
grant execute on function public.staff_register(uuid, uuid, boolean) to authenticated;
grant execute on function public.staff_promote(uuid, boolean) to authenticated;
grant execute on function public.staff_door_payment(uuid, boolean) to authenticated;
grant execute on function public.staff_set_payment(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.staff_merge_participants(uuid, uuid) to authenticated;

-- the public check-in endpoints changed here stay exactly as exposed before
revoke execute on function public.public_checkin(jsonb) from public;
revoke execute on function public.public_checkin_known(jsonb) from public;
revoke execute on function public.public_walkin(jsonb) from public;
grant execute on function public.public_checkin(jsonb) to anon, authenticated;
grant execute on function public.public_checkin_known(jsonb) to anon, authenticated;
grant execute on function public.public_walkin(jsonb) to anon, authenticated;
