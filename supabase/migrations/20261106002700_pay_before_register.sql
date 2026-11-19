-- Pay before registering (19.11.2026, owner's decisions in the "pay first" brief). A meeting with a fee AND a payment
-- link no longer registers on submitting the form: the person is 'pending_payment' until the provider ("יש חשבונית",
-- yeshlee.co.il) confirms the payment through its "document created" webhook, or the team confirms it by hand.
--
--  registrations.status  gains 'pending_payment'. It holds NO place: it is not counted anywhere 'registered' or
--                        'waitlisted' are counted (capacity, spots_left, is_full, the door list, reports, messages,
--                        exports). Every count that already filters by status = 'registered' / 'waitlisted' excludes it
--                        by itself; the few that only excluded 'cancelled' are changed here (listed below).
--  public_register       at a priced meeting with a link, when there is room: 'pending_payment' (+ the personal token,
--                        so the page can poll). A full meeting keeps today's waitlist (nobody pays to wait). The same
--                        person again: the same pending registration (and the same token when the page sends it back).
--  public_registration   for 'pending_payment' only: the full name and phone as typed, to fill in the payment page.
--  the webhook           the Edge Function supabase/functions/yesh-webhook (key in the URL, service role) calls
--                        public.service_yesh_payment(), granted to service_role only. It matches the payer's phone to the
--                        newest pending registration (14 days, meeting not ended, price <= amount), marks it paid
--                        (private.mark_paid_by_provider) and registers it, or puts it on the waitlist with a task for
--                        the team when the places ran out meanwhile. Idempotent on the document number. A payment that
--                        matches nothing is kept in public.unmatched_payments for the team to attach or dismiss.
--  staff                 staff_confirm_payment (the manual "אישור תשלום"), staff_unmatched_payments,
--                        staff_attach_payment, staff_dismiss_payment, staff_payment_webhook_status (admin).
--  counts changed        staff_checkin_list (the door list), name_mismatches, report_links, report_sources
--                        (registered_only), participant_stats (registrations_count, last_registered_at), the
--                        consented-recipients and "active" filters in the app; event_finance gains started_unpaid.
--  unchanged on purpose  free meetings and priced meetings without a link; walk-ins pay at the door as today (a pending
--                        person who turns up is checked in as a walk-in, see registrations_payment_guard).
--
-- No new anonymous function. Numbered before 20261106009000_privilege_hardening.sql; the grants are repeated here for
-- databases where it ran. Written to be re-applied safely (if not exists, drop … if exists, create or replace).

-- ───────────── status, task type ─────────────

alter table public.registrations drop constraint if exists registrations_status_check;
alter table public.registrations add constraint registrations_status_check
  check (status in ('registered', 'waitlisted', 'cancelled', 'pending_payment'));

-- the webhook looks up a pending registration by phone and recency
create index if not exists registrations_pending_payment_idx on public.registrations (registered_at) where status = 'pending_payment';

alter table public.follow_ups drop constraint if exists follow_ups_type_check;
alter table public.follow_ups add constraint follow_ups_type_check
  check (type in ('no_show', 'first_time', 'lapsed', 'waitlist', 'general', 'membership', 'payment'));

-- ───────────── payments that matched no registration ─────────────

-- Minimal: what the team needs to find the person (document number, amount, date, name and phone from the receipt).
create table if not exists public.unmatched_payments (
  id uuid primary key default gen_random_uuid(),
  doc_number text not null check (char_length(doc_number) between 1 and 40),
  doc_type text check (char_length(doc_type) <= 10),
  amount numeric(8, 2) not null check (amount > 0 and amount <= 100000),
  paid_at timestamptz not null default now(),
  customer_name text check (char_length(customer_name) <= 80),
  phone text check (char_length(phone) <= 20),
  status text not null default 'open' check (status in ('open', 'attached', 'dismissed')),
  registration_id uuid references public.registrations(id) on delete set null,
  note text check (char_length(note) <= 200),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  constraint unmatched_payments_resolved check (status = 'open' or resolved_at is not null)
);
create unique index if not exists unmatched_payments_doc_idx on public.unmatched_payments (coalesce(doc_type, ''), doc_number);
create index if not exists unmatched_payments_open_idx on public.unmatched_payments (received_at) where status = 'open';

alter table public.unmatched_payments enable row level security;
revoke all on public.unmatched_payments from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.unmatched_payments from authenticated;
grant select on public.unmatched_payments to authenticated;
-- staff (admin, coordinator) read; every change goes through the functions below
drop policy if exists unmatched_payments_read on public.unmatched_payments;
create policy unmatched_payments_read on public.unmatched_payments for select to authenticated
  using ((select private.has_role('admin', 'coordinator')));

drop trigger if exists audit_unmatched_payments on public.unmatched_payments;
create trigger audit_unmatched_payments after insert or update or delete on public.unmatched_payments
  for each row execute function private.audit_row('doc_number', 'amount', 'status', 'registration_id');

-- Every webhook document seen, once (the idempotency ledger) and what became of it. No personal data. Not served by the
-- API (private schema); the settings page reads only the last arrival through staff_payment_webhook_status().
create table if not exists private.payment_webhook_log (
  id bigint generated always as identity primary key,
  doc_key text not null unique,
  amount numeric(8, 2),
  outcome text not null default 'received'
    check (outcome in ('received', 'registered', 'waitlisted', 'paid', 'unmatched', 'ignored')),
  registration_id uuid,
  received_at timestamptz not null default now()
);
revoke all on private.payment_webhook_log from public, anon, authenticated;

-- ───────────── the payment columns ─────────────

-- As in 20261106002300, plus: a pending-payment registration owes the fee too, and a pending person checked in at the
-- door (any check-in path sets status 'registered' + attended) arrived without a place: a walk-in, who pays at the door.
create or replace function private.registrations_payment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_price numeric;
begin
  if current_setting('app.payment', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.payment_status := 'none';
      new.paid_amount := null; new.paid_at := null; new.payment_method := null; new.payment_ref := null;
    else
      new.payment_status := old.payment_status;
      new.paid_amount := old.paid_amount; new.paid_at := old.paid_at;
      new.payment_method := old.payment_method; new.payment_ref := old.payment_ref;
    end if;
  end if;
  -- a new (or renewed, after a cancellation) registration to a priced meeting owes the fee
  if new.payment_status = 'none' and new.status in ('registered', 'waitlisted', 'pending_payment')
     and (tg_op = 'INSERT' or old.status = 'cancelled') then
    select price into v_price from public.events where id = new.event_id;
    if coalesce(v_price, 0) > 0 then
      new.payment_status := 'pending';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending_payment' and new.status = 'registered' and new.attendance = 'attended' then
    new.is_walk_in := true;
  end if;
  return new;
end $$;

create or replace function private.event_price_follow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := current_setting('app.payment', true);
begin
  if (coalesce(old.price, 0) > 0) = (coalesce(new.price, 0) > 0) then
    return null;
  end if;
  perform set_config('app.payment', 'on', true);
  if coalesce(new.price, 0) > 0 then
    update public.registrations set payment_status = 'pending'
    where event_id = new.id and payment_status = 'none' and status in ('registered', 'waitlisted', 'pending_payment');
  else
    update public.registrations set payment_status = 'none'
    where event_id = new.id and payment_status = 'pending';
  end if;
  perform set_config('app.payment', coalesce(v_prev, ''), true);
  return null;
end $$;

-- ───────────── registering ─────────────

CREATE OR REPLACE FUNCTION public.public_register(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_settings public.settings;
  r private.person_input;
  v_part public.participants;
  v_pid uuid;
  v_is_new boolean;
  v_existing public.registrations;
  v_has_existing boolean;
  v_reg_id uuid;
  v_link_id uuid;
  v_ref_id uuid;
  v_ref_name text;
  v_token text;
  v_keep_token boolean := false;
  v_registered int;
  v_status text;
  v_proven boolean;
  v_pay_first boolean;
begin
  if coalesce(p ->> 'website', '') <> '' then
    -- honeypot field filled: answer like a success, store nothing
    return jsonb_build_object('status', 'registered', 'first_name', private.first_name(p ->> 'full_name'));
  end if;
  perform private.rate_limit('reg-ip:' || private.client_key(), 20, 3600);

  select * into v_event from public.events where public_code = lower(btrim(coalesce(p ->> 'event', ''))) for update;
  if not found or v_event.status = 'draft' then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  if v_event.status = 'cancelled' then
    raise exception 'event_cancelled' using errcode = 'P0001';
  end if;
  if v_event.status in ('closed', 'completed') or now() >= coalesce(v_event.registration_closes_at, v_event.starts_at) then
    raise exception 'registration_closed' using errcode = 'P0001';
  end if;
  -- a fee with a payment link: the registration is complete only once it is paid
  v_pay_first := coalesce(v_event.price, 0) > 0 and v_event.payment_url is not null;

  r := private.parse_person(p, true);
  perform private.rate_limit('reg-phone:' || private.sha(r.phone), 8, 3600);
  -- ceiling per event against scripted floods from many addresses (honeypot + per-IP limit catch the rest)
  perform private.rate_limit('reg-event:' || v_event.id, 150, 3600);

  select s.* into v_settings from public.settings s;
  perform set_config('app.consent_source', 'registration_form', true);
  perform set_config('app.consent_version', v_settings.consent_text_version, true);

  select x.link_id, x.referrer_id, x.referrer_name into v_link_id, v_ref_id, v_ref_name
  from private.resolve_referrer(p ->> 'ref', case when r.source_is_friend then r.referrer_text end, r.phone) x;

  select x.participant_id, x.is_new into v_pid, v_is_new
  from private.upsert_participant(r, 'registration', v_ref_id, v_ref_name) x;
  select * into v_part from public.participants where id = v_pid;
  -- a new person, or the name on the card: only then does the answer carry anything of the card (invite code, device)
  v_proven := v_is_new or private.same_name(v_part.full_name, r.full_name);

  select * into v_existing from public.registrations where event_id = v_event.id and participant_id = v_part.id for update;
  v_has_existing := found;
  -- answers echo only what the visitor typed: knowing a phone number must not reveal the stored name
  if v_has_existing and v_existing.status in ('registered', 'waitlisted', 'pending_payment')
     and private.first_name(lower(r.full_name)) <> private.first_name(lower(v_part.full_name)) then
    return jsonb_build_object('status', 'phone_in_use', 'first_name', private.first_name(r.full_name), 'event', private.event_public(v_event.id));
  end if;
  if v_has_existing and v_existing.status = 'registered' then
    return jsonb_build_object('status', 'already_registered', 'first_name', private.first_name(r.full_name),
                              'event', private.event_public(v_event.id));
  end if;
  if v_has_existing and v_existing.status = 'waitlisted' then
    return jsonb_build_object('status', 'already_waitlisted', 'first_name', private.first_name(r.full_name),
                              'waitlist_position', private.waitlist_position(v_existing.id),
                              'event', private.event_public(v_event.id));
  end if;
  -- Still waiting for the payment, and the page did not send this registration's own personal link: answer "pay" without
  -- touching the row or issuing a new link. Knowing someone's phone and name must never take over their registration
  -- (a new link would cut off theirs and let the caller cancel it). The real person can still pay: the payment is matched
  -- by phone and confirms the registration; the personal link they already have keeps working.
  if v_has_existing and v_existing.status = 'pending_payment'
     and (char_length(coalesce(p ->> 'token', '')) not between 20 and 100
          or v_existing.manage_token_hash is distinct from private.token_hash(p ->> 'token')) then
    return jsonb_build_object('status', 'pending_payment', 'first_name', private.first_name(r.full_name),
                              'token', null, 'event', private.event_public(v_event.id));
  end if;

  -- a pending registration holds no place, so it is not counted here
  select count(*) into v_registered from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is not null and (v_registered >= v_event.capacity
       or exists (select 1 from public.registrations w where w.event_id = v_event.id and w.status = 'waitlisted')) then
    if not v_event.waitlist_enabled then
      raise exception 'event_full' using errcode = 'P0001';
    end if;
    v_status := 'waitlisted';
  else
    v_status := case when v_pay_first then 'pending_payment' else 'registered' end;
  end if;

  -- the same person again while it is still unpaid, from the same page: the same personal link
  if v_has_existing and v_existing.status = 'pending_payment' and char_length(coalesce(p ->> 'token', '')) between 20 and 100
     and v_existing.manage_token_hash = private.token_hash(p ->> 'token') then
    v_token := p ->> 'token';
    v_keep_token := true;
  else
    v_token := private.new_token();
  end if;
  if v_has_existing then
    -- previously cancelled, or still waiting for the payment: register again (trusted: a new place in the queue)
    perform set_config('app.trusted', 'on', true);
    update public.registrations set
      status = v_status, registered_at = now(), attendance = 'unknown',
      cancelled_at = null, cancelled_by = null, cancel_reason = null,
      submitted_name = case when v_proven then null else r.full_name end,
      how_heard_source_id = r.source_id, how_heard_detail = r.source_detail,
      referrer_participant_id = coalesce(v_ref_id, referrer_participant_id),
      referrer_name = coalesce(v_ref_name, referrer_name),
      referral_link_id = coalesce(v_link_id, referral_link_id)
    where id = v_existing.id;
    perform set_config('app.trusted', '', true);
    if not v_keep_token then
      perform private.set_registration_token(v_existing.id, v_token);
    end if;
    v_reg_id := v_existing.id;
  else
    insert into public.registrations (
      event_id, participant_id, status, how_heard_source_id, how_heard_detail,
      referrer_participant_id, referrer_name, referral_link_id,
      utm_source, utm_medium, utm_campaign, submitted_name, manage_token_hash, created_via)
    values (
      v_event.id, v_part.id, v_status, r.source_id, r.source_detail,
      v_ref_id, v_ref_name, v_link_id,
      private.clean_text(p -> 'utm' ->> 'source', 100), private.clean_text(p -> 'utm' ->> 'medium', 100),
      private.clean_text(p -> 'utm' ->> 'campaign', 100),
      case when not v_proven then r.full_name end,
      private.token_hash(v_token), 'public_form')
    returning id into v_reg_id;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'first_name', private.first_name(r.full_name),
    'token', v_token,
    'invite_code', case when v_proven then v_part.referral_code end,
    'waitlist_position', case when v_status = 'waitlisted' then private.waitlist_position(v_reg_id) end,
    'event', private.event_public(v_event.id));
end $function$;

-- The personal link: for a pending payment also the name and phone as typed, so the pay button opens the provider's page
-- with them filled in (the token holder is the person who typed them).
CREATE OR REPLACE FUNCTION public.public_registration(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_event public.events;
  v_part public.participants;
  v_fb public.feedback;
  v_days int;
  v_pending boolean;
begin
  v_reg := private.registration_by_token(p_token);
  if v_reg.id is null then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  select * into v_part from public.participants where id = v_reg.participant_id;
  select * into v_fb from public.feedback where registration_id = v_reg.id;
  select feedback_days into v_days from public.settings;
  v_pending := v_reg.status = 'pending_payment' and v_part.anonymized_at is null;
  return jsonb_build_object(
    'status', v_reg.status,
    'attendance', v_reg.attendance,
    'first_name', private.registrant_first_name(v_reg),
    'invite_code', case when v_reg.submitted_name is null then v_part.referral_code end,
    'waitlist_position', case when v_reg.status = 'waitlisted' then private.waitlist_position(v_reg.id) end,
    'can_cancel', v_reg.status <> 'cancelled' and v_reg.attendance <> 'attended' and now() < v_event.starts_at
                  and v_event.status not in ('cancelled', 'completed'),
    'feedback_open', now() >= v_event.starts_at and now() <= v_event.ends_at + make_interval(days => v_days) and v_event.status <> 'cancelled',
    'feedback_given', v_fb.id is not null,
    'payment_status', v_reg.payment_status,
    'full_name', case when v_pending then coalesce(v_reg.submitted_name, v_part.full_name) end,
    'phone', case when v_pending then v_part.phone end,
    'event', private.event_public(v_event.id));
end $function$;

-- ───────────── placing a paid registration ─────────────

-- A pending registration that has just been paid (or waived): registered when there is room, otherwise on the waitlist
-- with a task for the team. The caller locks the meeting row first (public_register does the same), so two payments
-- arriving together cannot both take the last place. Returns the resulting status.
create or replace function private.place_paid_registration(p_reg_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_registered int;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found or v_reg.status <> 'pending_payment' then
    return v_reg.status;
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  select count(*) into v_registered from public.registrations where event_id = v_event.id and status = 'registered';
  if v_event.capacity is null or v_registered < v_event.capacity then
    update public.registrations set status = 'registered' where id = p_reg_id;
    return 'registered';
  end if;
  update public.registrations set status = 'waitlisted' where id = p_reg_id;
  insert into public.follow_ups (participant_id, event_id, type, title, notes, due_date, assignee_id, created_by)
  select v_reg.participant_id, v_reg.event_id, 'payment', 'תשלום התקבל ואין מקום פנוי',
         'התשלום התקבל אחרי שהמקומות במפגש נתפסו. ההרשמה נכנסה לרשימת ההמתנה: לפנות, ולקדם או להחזיר את התשלום.',
         private.local_today(), s.default_task_assignee, null
  from public.settings s
  on conflict (participant_id, event_id, type) where event_id is not null do nothing;
  return 'waitlisted';
end $$;

-- Locks the meeting, then the registration (the order public_register uses). Returns the registration.
create or replace function private.lock_registration(p_reg_id uuid)
returns public.registrations language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
begin
  perform 1 from public.events where id = (select event_id from public.registrations where id = p_reg_id) for update;
  select * into v_reg from public.registrations where id = p_reg_id for update;
  return v_reg;
end $$;

-- The provider hook (20261106002300), extended: a pending registration that is paid is placed (registered or waitlisted).
-- Idempotent: a retried callback for a registration that is already paid changes nothing.
create or replace function private.mark_paid_by_provider(p_registration_id uuid, p_amount numeric, p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_ref text := private.clean_text(p_ref, 100);
  v_out jsonb;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if v_ref is null then
    raise exception 'invalid_ref' using errcode = 'P0001';
  end if;
  v_reg := private.lock_registration(p_registration_id);
  if v_reg.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_reg.payment_status = 'paid' then
    return jsonb_build_object('registration_id', v_reg.id, 'payment_status', 'paid', 'already', true,
                              'same_ref', v_reg.payment_ref is not distinct from v_ref, 'status', v_reg.status);
  end if;
  v_out := private.write_payment(v_reg.id, 'paid', round(p_amount, 2), now(), 'card', v_ref);
  return v_out || jsonb_build_object('status', private.place_paid_registration(v_reg.id));
end $$;

-- ───────────── the "יש חשבונית" webhook ─────────────

-- p: {doc_number, doc_type, amount, phone, customer_name, doc_date}, already picked out of the provider's body by the Edge
-- Function. Nothing else in the body is trusted, and everything here is validated again.
--   duplicate   the document was seen before (any outcome): nothing changes
--   ignored     not a payment (no number, no positive amount), or no priced meeting with a link could be its subject
--   matched     the newest pending registration of that phone (14 days, meeting not ended, price <= amount) is paid and
--               registered (or waitlisted, with a task); else a registered place that still owes the fee is marked paid
--   unmatched   kept in public.unmatched_payments for the team
create or replace function private.yesh_payment(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_doc text := private.clean_text(p ->> 'doc_number', 40);
  v_type text := private.clean_text(p ->> 'doc_type', 10);
  v_raw_phone text := private.clean_text(left(p ->> 'phone', 40), 40);
  v_phone text;
  v_name text := private.clean_text(p ->> 'customer_name', 80);
  v_amount numeric;
  v_at timestamptz;
  v_log bigint;
  v_reg_id uuid;
  v_out jsonb;
  v_status text;
begin
  if v_doc is null or v_doc !~ '^[A-Za-z0-9_./-]{1,40}$' or (v_type is not null and v_type !~ '^[A-Za-z0-9_-]{1,10}$') then
    return jsonb_build_object('result', 'ignored');
  end if;
  begin
    v_amount := round((p ->> 'amount')::numeric, 2);
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount > 100000 then
    return jsonb_build_object('result', 'ignored');
  end if;
  v_phone := private.normalize_phone(v_raw_phone);
  begin
    v_at := (p ->> 'doc_date')::timestamp at time zone 'Asia/Jerusalem';
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at > now() + interval '1 day' or v_at < now() - interval '1 year' then
    v_at := now();
  end if;

  insert into private.payment_webhook_log (doc_key, amount) values (coalesce(v_type, '') || ':' || v_doc, v_amount)
  on conflict (doc_key) do nothing
  returning id into v_log;
  if v_log is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if random() < 0.02 then
    delete from private.payment_webhook_log where received_at < now() - interval '400 days';
  end if;

  if v_phone is not null then
    select r.id into v_reg_id
    from public.registrations r
    join public.participants pa on pa.id = r.participant_id
    join public.events e on e.id = r.event_id
    where pa.phone = v_phone and pa.anonymized_at is null
      and r.status = 'pending_payment' and r.payment_status in ('pending', 'none')
      and r.registered_at > now() - interval '14 days'
      and e.status in ('open', 'closed') and e.ends_at > now() and coalesce(e.price, 0) > 0 and e.price <= v_amount
    order by r.registered_at desc
    limit 1;
    if v_reg_id is null then
      -- a registered place that still owes the fee (promoted from the waitlist, or registered by the team), only at a
      -- meeting paid through this provider's link: a receipt for anything else (a donation, membership) never marks a
      -- place paid at a meeting where the fee is collected at the entrance
      select r.id into v_reg_id
      from public.registrations r
      join public.participants pa on pa.id = r.participant_id
      join public.events e on e.id = r.event_id
      where pa.phone = v_phone and pa.anonymized_at is null
        and r.status = 'registered' and r.payment_status = 'pending' and r.attendance <> 'no_show'
        and e.status in ('open', 'closed') and e.ends_at > now() and coalesce(e.price, 0) > 0 and e.price <= v_amount
        and e.payment_url is not null
      order by e.starts_at, r.registered_at desc
      limit 1;
    end if;
  end if;

  if v_reg_id is not null then
    v_out := private.mark_paid_by_provider(v_reg_id, v_amount, v_doc);
    v_status := coalesce(v_out ->> 'status', 'registered');
    update private.payment_webhook_log
    set outcome = case v_status when 'waitlisted' then 'waitlisted' when 'registered' then 'registered' else 'paid' end,
        registration_id = v_reg_id
    where id = v_log;
    return jsonb_build_object('result', 'matched', 'status', v_status);
  end if;

  -- the same account issues documents for other things too: keep only what could be a meeting fee
  if not exists (select 1 from public.events e
                 where coalesce(e.price, 0) > 0 and e.payment_url is not null and e.status <> 'draft' and e.price <= v_amount
                   and e.ends_at > now() - interval '14 days' and e.starts_at < now() + interval '180 days') then
    update private.payment_webhook_log set outcome = 'ignored' where id = v_log;
    return jsonb_build_object('result', 'ignored');
  end if;
  insert into public.unmatched_payments (doc_number, doc_type, amount, paid_at, customer_name, phone)
  values (v_doc, v_type, v_amount, v_at, v_name, coalesce(v_phone, left(v_raw_phone, 20)))
  on conflict do nothing;
  update private.payment_webhook_log set outcome = 'unmatched' where id = v_log;
  return jsonb_build_object('result', 'unmatched');
end $$;

-- The Edge Function's entry point (the private schema is not served by the API): the service role only.
create or replace function public.service_yesh_payment(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  return private.yesh_payment(p);
end $$;

-- ───────────── staff ─────────────

-- The manual "אישור תשלום" (a backup for the webhook): a pending registration is marked paid and registered, or put on
-- the waitlist when the meeting filled up meanwhile.
create or replace function public.staff_confirm_payment(p_registration_id uuid, p_amount numeric default null, p_ref text default null,
                                                        p_method text default 'card')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_price numeric;
  v_amount numeric;
  v_out jsonb;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_method is null or p_method not in ('card', 'bit', 'paybox', 'cash', 'transfer', 'other') then
    raise exception 'invalid_payment_method' using errcode = 'P0001';
  end if;
  v_reg := private.lock_registration(p_registration_id);
  if v_reg.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_reg.status <> 'pending_payment' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  select price into v_price from public.events where id = v_reg.event_id;
  v_amount := coalesce(p_amount, nullif(v_price, 0));
  if v_amount is null or v_amount <= 0 or v_amount > 100000 or v_amount <> round(v_amount, 2) then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  v_out := private.write_payment(v_reg.id, 'paid', v_amount, now(), p_method, private.clean_text(p_ref, 100));
  return v_out || jsonb_build_object('status', private.place_paid_registration(v_reg.id));
end $$;

-- As in 20261106002300, plus: paid (or waived) on a pending registration also places it.
create or replace function public.staff_set_payment(p_registration_id uuid, p_status text, p_amount numeric default null,
                                                    p_method text default null, p_ref text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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
  elsif p_status = 'refunded' then
    if v_reg.payment_status not in ('paid', 'refunded') then
      raise exception 'not_paid' using errcode = 'P0001';
    end if;
    return private.write_payment(v_reg.id, 'refunded', coalesce(p_amount, v_reg.paid_amount), v_reg.paid_at,
                                 v_reg.payment_method, coalesce(v_ref, v_reg.payment_ref));
  elsif p_status = 'waived' then
    v_out := private.write_payment(v_reg.id, 'waived', null, null, null, v_ref);
  else
    return private.write_payment(v_reg.id, p_status, null, null, null, null);
  end if;
  if v_reg.status = 'pending_payment' then
    v_out := v_out || jsonb_build_object('status', private.place_paid_registration(v_reg.id));
  end if;
  return v_out;
end $$;

-- The door marks cash for people on the door list; a pending registration is not on it (a pending person who arrives is
-- checked in as a walk-in first, and then pays at the door like any walk-in).
create or replace function public.staff_door_payment(p_registration_id uuid, p_paid boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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
  return private.write_payment(v_reg.id, 'pending', null, null, null, null);
end $$;

-- Open payments the webhook could not match, newest first, each with the registrations it could belong to: of one meeting
-- (p_event_id), or across meetings the ones with the same phone and every pending one of the last 14 days.
create or replace function public.staff_unmatched_payments(p_event_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'doc_number', u.doc_number, 'amount', u.amount, 'paid_at', u.paid_at, 'received_at', u.received_at,
             'customer_name', u.customer_name, 'phone', u.phone,
             'candidates', coalesce((
               select jsonb_agg(c.j order by c.phone_match desc, c.registered_at desc)
               from (
                 select coalesce(pa.phone = u.phone, false) as phone_match, r.registered_at,
                        jsonb_build_object('registration_id', r.id, 'event_id', e.id, 'event_title', e.title, 'starts_at', e.starts_at,
                                           'full_name', pa.full_name, 'phone', pa.phone, 'status', r.status,
                                           'payment_status', r.payment_status, 'phone_match', coalesce(pa.phone = u.phone, false)) as j
                 from public.registrations r
                 join public.participants pa on pa.id = r.participant_id and pa.anonymized_at is null
                 join public.events e on e.id = r.event_id
                 where coalesce(e.price, 0) > 0 and e.status not in ('draft', 'cancelled') and e.ends_at > now() - interval '14 days'
                   and r.status in ('pending_payment', 'registered', 'waitlisted') and r.payment_status in ('pending', 'none')
                   and (case when p_event_id is not null then r.event_id = p_event_id
                             else pa.phone = u.phone or (r.status = 'pending_payment' and r.registered_at > now() - interval '14 days') end)
                 order by coalesce(pa.phone = u.phone, false) desc, r.registered_at desc
                 limit 30) c), '[]'::jsonb))
           order by u.received_at desc)
    from public.unmatched_payments u
    where u.status = 'open'), '[]'::jsonb);
end $$;

-- Attach an unmatched payment to a registration: marked paid with the payment's amount and document number, and placed
-- when it was pending.
create or replace function public.staff_attach_payment(p_payment_id uuid, p_registration_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pay public.unmatched_payments;
  v_reg public.registrations;
  v_out jsonb;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_pay from public.unmatched_payments where id = p_payment_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'open' then
    raise exception 'already_resolved' using errcode = 'P0001';
  end if;
  v_reg := private.lock_registration(p_registration_id);
  if v_reg.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_reg.status = 'cancelled' then
    raise exception 'registration_cancelled' using errcode = 'P0001';
  end if;
  if v_reg.payment_status in ('paid', 'refunded') then
    raise exception 'already_paid' using errcode = 'P0001';
  end if;
  v_out := private.write_payment(v_reg.id, 'paid', v_pay.amount, v_pay.paid_at, 'card', v_pay.doc_number);
  v_out := v_out || jsonb_build_object('status', private.place_paid_registration(v_reg.id));
  update public.unmatched_payments
  set status = 'attached', registration_id = v_reg.id, resolved_at = now(), resolved_by = (select auth.uid())
  where id = v_pay.id;
  return v_out;
end $$;

-- Not a meeting fee (or handled elsewhere): out of the list, kept for the record.
create or replace function public.staff_dismiss_payment(p_payment_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pay public.unmatched_payments;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_pay from public.unmatched_payments where id = p_payment_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'open' then
    raise exception 'already_resolved' using errcode = 'P0001';
  end if;
  update public.unmatched_payments
  set status = 'dismissed', note = private.clean_text(p_note, 200), resolved_at = now(), resolved_by = (select auth.uid())
  where id = v_pay.id;
  return jsonb_build_object('id', v_pay.id, 'status', 'dismissed');
end $$;

-- Settings → general (admin): whether the webhook works, without the key (the key exists only in the Edge Function's
-- secrets). The last document received tells the admin that the URL in "יש חשבונית" and the secret agree.
create or replace function public.staff_payment_webhook_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_role('admin');
  return jsonb_build_object(
    'last_received_at', (select max(received_at) from private.payment_webhook_log),
    'last_outcome', (select outcome from private.payment_webhook_log order by received_at desc, id desc limit 1),
    'received_30d', (select count(*) from private.payment_webhook_log where received_at > now() - interval '30 days'),
    'matched_30d', (select count(*) from private.payment_webhook_log
                    where received_at > now() - interval '30 days' and outcome in ('registered', 'waitlisted', 'paid')),
    'unmatched_open', (select count(*) from public.unmatched_payments where status = 'open'));
end $$;

-- staff_register: a pending registration (started, not paid) can be registered by the team, like a cancelled one
CREATE OR REPLACE FUNCTION public.staff_register(p_event_id uuid, p_participant_id uuid, p_over_capacity boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_reg public.registrations;
  v_count int;
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
  select count(*) into v_count from public.registrations where event_id = p_event_id and status = 'registered';
  v_status := case when v_event.capacity is not null and v_count >= v_event.capacity and not p_over_capacity
                   then 'waitlisted' else 'registered' end;
  select * into v_reg from public.registrations where event_id = p_event_id and participant_id = p_participant_id for update;
  if found then
    if v_reg.status not in ('cancelled', 'pending_payment') then
      raise exception 'already_registered' using errcode = 'P0001';
    end if;
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

-- staff_personal_link: also for a pending registration (the team sends it to finish paying)
CREATE OR REPLACE FUNCTION public.staff_personal_link(p_registration_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reg public.registrations;
  v_event public.events;
  v_token text;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found or v_reg.status not in ('registered', 'waitlisted', 'pending_payment') then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.status in ('cancelled', 'completed') or v_event.ends_at < now() then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.participants p where p.id = v_reg.participant_id and p.anonymized_at is null and p.phone is not null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  v_token := private.new_token();
  perform private.set_registration_token(v_reg.id, v_token);
  perform private.audit_action('personal_link', 'registrations', v_reg.id::text, null);
  return v_token;
end $function$;

-- ───────────── counts and lists that only excluded 'cancelled' ─────────────

-- the door list: people with a place (or on the waitlist, or cancelled); not someone who started and did not pay
CREATE OR REPLACE FUNCTION public.staff_checkin_list(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        case when r.status = 'waitlisted' then private.waitlist_position(r.id) end as waitlist_position,
        -- the door sees only whether they paid (and how, for a cash mark it may undo), never amounts or references
        r.payment_status,
        coalesce(r.payment_method = 'cash' and r.payment_ref is null and r.paid_at > now() - interval '15 minutes', false) as cash_just_marked
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
      where r.event_id = p_event_id and r.status <> 'pending_payment'
    ) x), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION private.name_mismatches()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'registration_id', r.id, 'event_id', e.id, 'event_title', e.title, 'starts_at', e.starts_at,
           'participant_id', p.id, 'card_name', p.full_name, 'typed_name', r.submitted_name) order by e.starts_at), '[]'::jsonb)
  from public.registrations r
  join public.events e on e.id = r.event_id
  join public.participants p on p.id = r.participant_id
  where r.submitted_name is not null and r.status in ('registered', 'waitlisted') and e.ends_at > now() - interval '1 day'
    and e.status not in ('cancelled', 'draft')
$function$;

CREATE OR REPLACE FUNCTION public.report_links(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with first_reg as (
      select distinct on (participant_id) participant_id, id from public.registrations
      where status <> 'pending_payment' order by participant_id, registered_at)
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'code', l.code, 'label', l.label, 'source_label', s.label, 'campaign', l.campaign, 'is_active', l.is_active,
      'registrations', x.registrations, 'attended', x.attended, 'new_people', x.new_people) order by x.registrations desc, l.label)
    from public.referral_links l
    left join public.acquisition_sources s on s.id = l.source_id
    cross join lateral (
      select count(r.id) as registrations,
             count(r.id) filter (where r.attendance = 'attended') as attended,
             count(r.id) filter (where fr.id is not null) as new_people
      from public.registrations r left join first_reg fr on fr.id = r.id
      where r.referral_link_id = l.id and r.status <> 'pending_payment' and private.in_period(r.registered_at, p_from, p_to)) x), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.report_sources(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform private.assert_role('admin', 'coordinator');
  return coalesce((
    with first_any as (
      select r.participant_id, min(e.starts_at) as first_at, count(*) as attended
      from public.registrations r join public.events e on e.id = r.event_id
      where r.attendance = 'attended' group by r.participant_id),
    cohort as (select * from first_any where private.in_period(first_at, p_from, p_to)),
    came as (
      select p.first_source_id as source_id, count(*) as participants,
             count(*) filter (where c.attended >= 2) as returned,
             round(avg(c.attended), 2) as avg_attended,
             count(*) filter (where p.referred_by_participant_id is not null) as with_referrer
      from cohort c join public.participants p on p.id = c.participant_id
      group by p.first_source_id),
    never as (
      -- registered and never came; someone who only started a paid registration and did not pay is not counted
      select p.first_source_id as source_id, count(*) as registered_only
      from public.participants p
      where p.anonymized_at is null and private.in_period(p.created_at, p_from, p_to)
        and not exists (select 1 from first_any f where f.participant_id = p.id)
        and (not exists (select 1 from public.registrations x where x.participant_id = p.id and x.status = 'pending_payment')
             or exists (select 1 from public.registrations x where x.participant_id = p.id and x.status <> 'pending_payment'))
      group by p.first_source_id)
    select jsonb_agg(jsonb_build_object(
      'source_id', k.source_id, 'label', coalesce(s.label, 'לא ידוע'), 'is_friend', coalesce(s.is_friend, false),
      'participants', coalesce(came.participants, 0), 'returned', coalesce(came.returned, 0),
      'avg_attended', came.avg_attended, 'with_referrer', coalesce(came.with_referrer, 0),
      'registered_only', coalesce(never.registered_only, 0))
      order by coalesce(came.participants, 0) desc, coalesce(never.registered_only, 0) desc)
    from (select source_id from came union select source_id from never) k
    left join came on came.source_id is not distinct from k.source_id
    left join never on never.source_id is not distinct from k.source_id
    left join public.acquisition_sources s on s.id = k.source_id), '[]'::jsonb);
end $function$;

-- participant_stats (20261106000600): registrations_count and last_registered_at leave out unpaid pending registrations
create or replace view public.participant_stats with (security_invoker = true) as
with s as (
  select regular_min_fridays, regular_window_days, lapsed_after_fridays from public.settings limit 1
),
att as (
  select r.participant_id, e.id as event_id, e.type, e.site_id, e.starts_at
  from public.registrations r join public.events e on e.id = r.event_id
  where r.attendance = 'attended'
),
agg as (
  select a.participant_id,
         count(*)::int as attended_count,
         count(*) filter (where a.type = 'friday')::int as friday_count,
         count(*) filter (where a.type = 'bonfire')::int as bonfire_count,
         min(a.starts_at) as first_attended_at,
         max(a.starts_at) as last_attended_at,
         max(a.starts_at) filter (where a.type = 'friday') as last_friday_at,
         count(*) filter (where a.type = 'friday' and a.starts_at >= now() - make_interval(days => (select regular_window_days from s)))::int
           as recent_fridays
  from att a group by a.participant_id
),
ever_regular as (
  select distinct x.participant_id from (
    select a.participant_id, a.starts_at,
           lag(a.starts_at, (select regular_min_fridays from s) - 1) over (partition by a.participant_id order by a.starts_at) as prev
    from att a where a.type = 'friday'
  ) x
  where x.prev is not null and x.starts_at - x.prev <= make_interval(days => (select regular_window_days from s))
),
home_site as (
  select distinct on (a.participant_id) a.participant_id, a.site_id
  from att a where a.type = 'friday' order by a.participant_id, a.starts_at desc
),
regs as (
  select r.participant_id,
         count(*)::int as registrations_count,
         count(*) filter (where r.attendance = 'no_show')::int as no_show_count,
         count(*) filter (where r.status = 'cancelled')::int as cancel_count,
         max(r.registered_at) as last_registered_at
  from public.registrations r where r.status <> 'pending_payment' group by r.participant_id
),
fb as (
  select f.participant_id, count(*)::int as feedback_count, round(avg(f.overall_rating), 2) as avg_rating_given
  from public.feedback f where f.participant_id is not null group by f.participant_id
),
friends as (
  select p.referred_by_participant_id as participant_id, count(*)::int as friends_brought
  from public.participants p where p.referred_by_participant_id is not null group by 1
)
select
  p.id as participant_id,
  coalesce(a.attended_count, 0) as attended_count,
  coalesce(a.friday_count, 0) as friday_count,
  coalesce(a.bonfire_count, 0) as bonfire_count,
  a.first_attended_at,
  a.last_attended_at,
  a.last_friday_at,
  coalesce(rg.registrations_count, 0) as registrations_count,
  coalesce(rg.no_show_count, 0) as no_show_count,
  coalesce(rg.cancel_count, 0) as cancel_count,
  rg.last_registered_at,
  coalesce(fb.feedback_count, 0) as feedback_count,
  fb.avg_rating_given,
  coalesce(fr.friends_brought, 0) as friends_brought,
  er.participant_id is not null as ever_regular,
  coalesce(a.recent_fridays, 0) >= s.regular_min_fridays as is_regular,
  coalesce(missed.n, 0) as fridays_missed,
  case
    when coalesce(a.attended_count, 0) = 0 then 'registered'
    when coalesce(a.recent_fridays, 0) >= s.regular_min_fridays then 'regular'
    when er.participant_id is not null and coalesce(missed.n, 0) >= s.lapsed_after_fridays then 'lapsed'
    when a.attended_count = 1 then 'first_timer'
    else 'returning'
  end as engagement_status
from public.participants p
cross join s
left join agg a on a.participant_id = p.id
left join regs rg on rg.participant_id = p.id
left join fb on fb.participant_id = p.id
left join friends fr on fr.participant_id = p.id
left join ever_regular er on er.participant_id = p.id
left join home_site hs on hs.participant_id = p.id
left join lateral (
  -- Friday meetings that took place at the participant's site since their last visit (any activity type)
  select count(*)::int as n from public.events e
  where e.type = 'friday' and e.site_id = hs.site_id and e.status not in ('draft', 'cancelled')
    and e.ends_at < now() and e.starts_at > a.last_attended_at
) missed on er.participant_id is not null
where p.anonymized_at is null;
revoke all on public.participant_stats from anon, public;
grant select on public.participant_stats to authenticated;

-- One meeting's money (20261106002300), plus started_unpaid: registrations that started and were never paid. They are
-- not registered and not income; the number tells the team whom to reach out to.
create or replace function private.event_finance(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with e as (
    select id, coalesce(price, 0) as price, payment_url is not null as has_link from public.events where id = p_event_id
  ), r as (
    select
      count(*) filter (where x.status = 'registered')::int as registered,
      count(*) filter (where x.payment_status = 'paid')::int as paid_count,
      coalesce(sum(x.paid_amount) filter (where x.payment_status = 'paid'), 0) as collected,
      count(*) filter (where x.payment_status = 'pending' and x.status = 'registered' and x.attendance <> 'no_show')::int as pending_count,
      count(*) filter (where x.payment_status = 'waived' and x.status in ('registered', 'waitlisted'))::int as waived_count,
      count(*) filter (where x.payment_status = 'refunded')::int as refunded_count,
      coalesce(sum(x.paid_amount) filter (where x.payment_status = 'refunded'), 0) as refunded_amount,
      count(*) filter (where x.status = 'pending_payment')::int as started_unpaid
    from public.registrations x where x.event_id = p_event_id
  ), p as (
    select count(*)::int as items,
           coalesce(sum(amount), 0) as total,
           coalesce(sum(amount) filter (where paid_on is not null), 0) as paid
    from public.event_payments where event_id = p_event_id
  )
  select jsonb_build_object(
    'event_id', e.id,
    'price', nullif(e.price, 0),
    'has_payment_link', e.has_link,
    'registered', r.registered,
    'started_unpaid', r.started_unpaid,
    'income', jsonb_build_object(
      'expected', r.collected + r.pending_count * e.price,
      'collected', r.collected,
      'paid_count', r.paid_count,
      'pending_count', r.pending_count,
      'pending_amount', r.pending_count * e.price,
      'waived_count', r.waived_count,
      'refunded_count', r.refunded_count,
      'refunded_amount', r.refunded_amount),
    'expenses', jsonb_build_object('count', p.items, 'total', p.total, 'paid', p.paid, 'unpaid', p.total - p.paid),
    'net', r.collected - p.paid,
    'projected_net', r.collected + r.pending_count * e.price - p.total)
  from e, r, p
$$;

-- the dashboard: open unmatched payments (runs as the signed-in user; RLS on unmatched_payments applies)
CREATE OR REPLACE FUNCTION public.attention_items()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  perform private.assert_role('admin', 'coordinator');
  return jsonb_build_object(
    'lapsed', coalesce((
      select jsonb_agg(jsonb_build_object('participant_id', p.id, 'full_name', p.full_name, 'last_attended_at', ps.last_attended_at,
                                          'friday_count', ps.friday_count, 'fridays_missed', ps.fridays_missed,
                                          'has_open_task', exists (select 1 from public.follow_ups f where f.participant_id = p.id and f.status = 'open'))
                       order by ps.last_attended_at desc)
      from public.participant_stats ps join public.participants p on p.id = ps.participant_id
      where ps.engagement_status = 'lapsed'), '[]'::jsonb),
    'followups_open', (select count(*) from public.follow_ups where status = 'open'),
    'followups_overdue', (select count(*) from public.follow_ups where status = 'open' and due_date < private.local_today()),
    'followups_mine', (select count(*) from public.follow_ups where status = 'open' and assignee_id = v_uid),
    'events_unclosed', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
      from public.events e where e.status in ('open', 'closed') and e.ends_at < now()), '[]'::jsonb),
    'fridays_without_speaker', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
      from public.events e left join public.speakers sp on sp.id = e.speaker_id
      where e.type = 'friday' and e.status not in ('cancelled', 'completed') and e.starts_at > now()
        and e.starts_at < now() + interval '35 days'
        and (e.speaker_id is null or sp.status <> 'approved')), '[]'::jsonb),
    'waitlist_with_space', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
                                          'waitlisted', st.waitlisted_count, 'free', e.capacity - st.registered_count))
      from public.events e join public.event_stats st on st.event_id = e.id
      where e.status = 'open' and e.starts_at > now() and st.waitlisted_count > 0
        and (e.capacity is null or st.registered_count < e.capacity)), '[]'::jsonb),
    'drafts_soon', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
      from public.events e where e.status = 'draft' and e.starts_at > now() and e.starts_at < now() + interval '8 days'), '[]'::jsonb),
    'proposals_pending', (select count(*) from public.speakers where status = 'proposed'),
    'name_mismatches', private.name_mismatches(),
    'aftercare', private.aftercare_ready(),
    'unmatched_payments', (select count(*) from public.unmatched_payments where status = 'open'));
end $function$;

-- ───────────── grants ─────────────

-- private helpers: reached only from the functions above (definer), never directly
revoke execute on function private.registrations_payment_guard() from public, anon, authenticated;
revoke execute on function private.event_price_follow() from public, anon, authenticated;
revoke execute on function private.place_paid_registration(uuid) from public, anon, authenticated;
revoke execute on function private.lock_registration(uuid) from public, anon, authenticated;
revoke execute on function private.yesh_payment(jsonb) from public, anon, authenticated;
revoke execute on function private.event_finance(uuid) from public, anon, authenticated;
revoke execute on function private.mark_paid_by_provider(uuid, numeric, text) from public, anon, authenticated;
grant execute on function private.mark_paid_by_provider(uuid, numeric, text) to service_role;
-- attention_items() runs as the signed-in user and calls this one (as in 20261106009100)
revoke execute on function private.name_mismatches() from public, anon;
grant execute on function private.name_mismatches() to authenticated;

-- the webhook entry point: the service role only (the pattern of public.service_rate_limit)
revoke execute on function public.service_yesh_payment(jsonb) from public, anon, authenticated;
grant execute on function public.service_yesh_payment(jsonb) to service_role;

-- the staff functions check the role themselves
revoke execute on function public.staff_confirm_payment(uuid, numeric, text, text) from public, anon;
revoke execute on function public.staff_set_payment(uuid, text, numeric, text, text) from public, anon;
revoke execute on function public.staff_door_payment(uuid, boolean) from public, anon;
revoke execute on function public.staff_unmatched_payments(uuid) from public, anon;
revoke execute on function public.staff_attach_payment(uuid, uuid) from public, anon;
revoke execute on function public.staff_dismiss_payment(uuid, text) from public, anon;
revoke execute on function public.staff_payment_webhook_status() from public, anon;
revoke execute on function public.staff_register(uuid, uuid, boolean) from public, anon;
revoke execute on function public.staff_personal_link(uuid) from public, anon;
revoke execute on function public.staff_checkin_list(uuid) from public, anon;
revoke execute on function public.report_links(date, date) from public, anon;
revoke execute on function public.report_sources(date, date) from public, anon;
revoke execute on function public.attention_items() from public, anon;
grant execute on function public.staff_confirm_payment(uuid, numeric, text, text) to authenticated;
grant execute on function public.staff_set_payment(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.staff_door_payment(uuid, boolean) to authenticated;
grant execute on function public.staff_unmatched_payments(uuid) to authenticated;
grant execute on function public.staff_attach_payment(uuid, uuid) to authenticated;
grant execute on function public.staff_dismiss_payment(uuid, text) to authenticated;
grant execute on function public.staff_payment_webhook_status() to authenticated;
grant execute on function public.staff_register(uuid, uuid, boolean) to authenticated;
grant execute on function public.staff_personal_link(uuid) to authenticated;
grant execute on function public.staff_checkin_list(uuid) to authenticated;
grant execute on function public.report_links(date, date) to authenticated;
grant execute on function public.report_sources(date, date) to authenticated;
grant execute on function public.attention_items() to authenticated;

-- the two public endpoints changed here stay exactly as exposed before
revoke execute on function public.public_register(jsonb) from public;
revoke execute on function public.public_registration(text) from public;
grant execute on function public.public_register(jsonb) to anon, authenticated;
grant execute on function public.public_registration(text) to anon, authenticated;
