-- Participant payments and a per-meeting financial snapshot (17.11.2026). The association starts charging a participation
-- fee (20 ₪ per Friday meeting, from the coordinator's work sheet). The card-processing provider is not chosen yet
-- (Grow/Meshulam, Cardcom, PayPlus, Tranzila, Bit/PayBox business links), so this layer is provider-agnostic:
--
--  day one   the team pastes the provider's hosted payment-page LINK on the meeting (events.payment_url). The visitor
--            opens it as a normal link (target=_blank) after registering, or later from the personal link (#/m/<token>).
--            We never see, collect or store card data: the CSP allows no external scripts or frames, and payment always
--            happens on the provider's own page. The team marks who paid (staff_set_payment), and the door team marks
--            cash at the entrance (staff_door_payment).
--  later     a provider webhook (an Edge Function holding the service role) calls private.mark_paid_by_provider(), which
--            marks the registration paid with the provider's transaction id. See the note above that function.
--
--  events.price           numeric(8,2); null or 0 = free
--  events.payment_url     the hosted payment page, https only, up to 500 characters
--  events.payment_note    a short line for the public page ("אפשר לשלם גם במקום"), up to 200 characters
--  registrations.payment_status  none | pending | paid | waived | refunded
--                         'none'    free meetings, and every row from before this change
--                         'pending' a registration (or a waitlisted one, or a walk-in) at a priced meeting
--                         'paid'    with paid_amount, paid_at, payment_method and payment_ref
--                         'waived'  the team let them in free (a guest, a hardship); not counted as owed
--                         'refunded' paid and given back (paid_amount keeps what was refunded)
--
-- Pending and the waitlist: a waitlisted row also starts as 'pending', so promotion needs no extra step and nothing is
-- forgotten. It is NOT asked to pay: the public pages show the pay button only for status 'registered', and a pending
-- waitlisted row is not counted as owed in the finance snapshot. A no-show who never paid is not owed either.
-- If the price is set (or removed) after people registered, the active registrations follow: none ↔ pending.
--
-- The payment columns change only inside the functions below (a guard trigger freezes them on every other update, like
-- the manage token): staff edit registrations directly under RLS, and must not be able to mark payment without the
-- validation and audit. No new anonymous function: the public payloads (event_public, public_registration) only gain
-- fields. Numbered before 20261106009000_privilege_hardening.sql; grants are repeated here for databases where it ran.
-- Written to be re-applied safely (if not exists, drop … if exists, create or replace).

-- ───────────── columns ─────────────

alter table public.events
  add column if not exists price numeric(8, 2)
    constraint events_price_check check (price is null or (price >= 0 and price <= 10000)),
  add column if not exists payment_url text
    constraint events_payment_url_check check (
      payment_url is null
      or (char_length(payment_url) <= 500 and payment_url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]<>"'']*)?$')),
  add column if not exists payment_note text
    constraint events_payment_note_check check (char_length(payment_note) <= 200);

alter table public.registrations
  add column if not exists payment_status text not null default 'none'
    constraint registrations_payment_status_check check (payment_status in ('none', 'pending', 'paid', 'waived', 'refunded')),
  add column if not exists paid_amount numeric(8, 2)
    constraint registrations_paid_amount_check check (paid_amount is null or (paid_amount >= 0 and paid_amount <= 100000)),
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text
    constraint registrations_payment_method_check check (payment_method in ('card', 'bit', 'paybox', 'cash', 'transfer', 'other')),
  add column if not exists payment_ref text
    constraint registrations_payment_ref_check check (char_length(payment_ref) <= 100);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registrations_paid_stamp') then
    alter table public.registrations add constraint registrations_paid_stamp
      check (payment_status not in ('paid', 'refunded') or (paid_at is not null and paid_amount is not null));
  end if;
end $$;

-- the "not paid yet" list of a meeting, and the period report
create index if not exists registrations_payment_idx on public.registrations (event_id, payment_status);

-- ───────────── the payment columns are set by the database ─────────────

-- Every insert starts from 'none' (or 'pending' at a priced meeting); every other update keeps the payment columns as
-- they were. Only the functions in this file turn on app.payment for their own update.
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
  if new.payment_status = 'none' and new.status in ('registered', 'waitlisted')
     and (tg_op = 'INSERT' or old.status = 'cancelled') then
    select price into v_price from public.events where id = new.event_id;
    if coalesce(v_price, 0) > 0 then
      new.payment_status := 'pending';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists registrations_payment on public.registrations;
create trigger registrations_payment before insert or update on public.registrations
  for each row execute function private.registrations_payment_guard();

-- payment changes are in the audit log with their amount and method (the reference is a provider id or a note: kept
-- out of the log, it is on the row)
drop trigger if exists audit_registrations on public.registrations;
create trigger audit_registrations after insert or update on public.registrations
  for each row execute function private.audit_row('event_id', 'status', 'attendance', 'is_walk_in', 'checkin_method', 'created_via', 'cancelled_by',
                                                  'payment_status', 'paid_amount', 'payment_method');
drop trigger if exists audit_events on public.events;
create trigger audit_events after insert or update or delete on public.events
  for each row execute function private.audit_row('type', 'status', 'starts_at', 'capacity', 'price');

-- the price set (or removed) after people registered: the active registrations follow
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
    where event_id = new.id and payment_status = 'none' and status in ('registered', 'waitlisted');
  else
    update public.registrations set payment_status = 'none'
    where event_id = new.id and payment_status = 'pending';
  end if;
  perform set_config('app.payment', coalesce(v_prev, ''), true);
  return null;
end $$;

drop trigger if exists events_price_follow on public.events;
create trigger events_price_follow after update of price on public.events
  for each row execute function private.event_price_follow();

-- ───────────── what visitors see ─────────────

-- the public event payload gains price, payment_url and payment_note (the link only when there is a price)
create or replace function private.event_public(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', e.public_code,
    'title', e.title,
    'type', e.type,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'location', coalesce(e.location, si.address, si.name),
    'site_name', si.name,
    'description', e.description,
    'activity_name', e.activity_name,
    'instructor_name', case when i.status = 'approved' then i.full_name end,
    'speaker_name', case when s.status = 'approved' then s.full_name end,
    'speaker_bio', case when s.status = 'approved' then s.bio_line end,
    'lecture_topic', coalesce(e.lecture_topic, case when s.status = 'approved' then s.topic end),
    'status', e.status,
    'registration_open', e.status = 'open' and now() < coalesce(e.registration_closes_at, e.starts_at),
    'is_full', e.capacity is not null and (c.registered >= e.capacity or c.waiting > 0),
    'spots_left', case when e.capacity is not null and c.waiting > 0 then 0
                       when e.capacity is not null and e.capacity - c.registered <= 10 then greatest(e.capacity - c.registered, 0) end,
    'waitlist_enabled', e.waitlist_enabled,
    'price', case when e.price > 0 then e.price end,
    'payment_url', case when e.price > 0 then e.payment_url end,
    'payment_note', case when e.price > 0 then e.payment_note end
  )
  from public.events e
  join public.sites si on si.id = e.site_id
  left join public.speakers s on s.id = e.speaker_id
  left join public.speakers i on i.id = e.instructor_id
  cross join lateral (
    select count(*) filter (where r.status = 'registered')::int as registered,
           count(*) filter (where r.status = 'waitlisted')::int as waiting
    from public.registrations r where r.event_id = e.id
  ) c
  where e.id = p_event_id
$$;

-- the personal link: the person's own payment status, so they can pay later (the price and link are in `event`)
create or replace function public.public_registration(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_code text;
  v_fb public.feedback;
  v_days int;
begin
  v_reg := private.registration_by_token(p_token);
  if v_reg.id is null then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  select referral_code into v_code from public.participants where id = v_reg.participant_id;
  select * into v_fb from public.feedback where registration_id = v_reg.id;
  select feedback_days into v_days from public.settings;
  return jsonb_build_object(
    'status', v_reg.status,
    'attendance', v_reg.attendance,
    'first_name', private.registrant_first_name(v_reg),
    'invite_code', case when v_reg.submitted_name is null then v_code end,
    'waitlist_position', case when v_reg.status = 'waitlisted' then private.waitlist_position(v_reg.id) end,
    'can_cancel', v_reg.status <> 'cancelled' and v_reg.attendance <> 'attended' and now() < v_event.starts_at
                  and v_event.status not in ('cancelled', 'completed'),
    'feedback_open', now() >= v_event.starts_at and now() <= v_event.ends_at + make_interval(days => v_days) and v_event.status <> 'cancelled',
    'feedback_given', v_fb.id is not null,
    'payment_status', v_reg.payment_status,
    'event', private.event_public(v_event.id));
end $$;

-- ───────────── the door list: who has not paid ─────────────

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
      where r.event_id = p_event_id
    ) x), '[]'::jsonb);
end $$;

-- ───────────── marking payment ─────────────

-- one place that writes the payment columns (with app.payment on for its own update only)
create or replace function private.write_payment(p_reg_id uuid, p_status text, p_amount numeric, p_paid_at timestamptz,
                                                 p_method text, p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_prev text := current_setting('app.payment', true);
  v_out jsonb;
begin
  perform set_config('app.payment', 'on', true);
  update public.registrations
  set payment_status = p_status, paid_amount = p_amount, paid_at = p_paid_at, payment_method = p_method, payment_ref = p_ref
  where id = p_reg_id
  returning jsonb_build_object('registration_id', id, 'payment_status', payment_status, 'paid_amount', paid_amount,
                               'paid_at', paid_at, 'payment_method', payment_method, 'payment_ref', payment_ref) into v_out;
  perform set_config('app.payment', coalesce(v_prev, ''), true);
  return v_out;
end $$;

-- Staff (admin, coordinator) mark a registration's payment. paid: the amount defaults to the meeting's price, paid_at is
-- kept when it was already paid; refunded: only after paid, keeps the amount; pending, waived, none: clear the payment.
create or replace function public.staff_set_payment(p_registration_id uuid, p_status text, p_amount numeric default null,
                                                    p_method text default null, p_ref text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_price numeric;
  v_amount numeric;
  v_ref text := private.clean_text(p_ref, 100);
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
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select price into v_price from public.events where id = v_reg.event_id;

  if p_status = 'paid' then
    v_amount := coalesce(p_amount, nullif(v_price, 0));
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_amount' using errcode = 'P0001';
    end if;
    return private.write_payment(v_reg.id, 'paid', v_amount,
                                 case when v_reg.payment_status = 'paid' then v_reg.paid_at else now() end,
                                 coalesce(p_method, 'other'), v_ref);
  elsif p_status = 'refunded' then
    if v_reg.payment_status not in ('paid', 'refunded') then
      raise exception 'not_paid' using errcode = 'P0001';
    end if;
    return private.write_payment(v_reg.id, 'refunded', coalesce(p_amount, v_reg.paid_amount), v_reg.paid_at,
                                 v_reg.payment_method, coalesce(v_ref, v_reg.payment_ref));
  elsif p_status = 'waived' then
    return private.write_payment(v_reg.id, 'waived', null, null, null, v_ref);
  else
    return private.write_payment(v_reg.id, p_status, null, null, null, null);
  end if;
end $$;
revoke execute on function public.staff_set_payment(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.staff_set_payment(uuid, text, numeric, text, text) to authenticated;

-- The door team (and staff in door mode): one tap "paid at the entrance" in cash, at the meeting's price, around the
-- meeting's time only (the same window as the attendance list). p_paid = false undoes a cash mark made in the last
-- 15 minutes (a wrong tap); anything else is changed from the office (staff_set_payment).
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
    if v_reg.status = 'cancelled' or v_reg.payment_status not in ('pending', 'none') then
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
revoke execute on function public.staff_door_payment(uuid, boolean) from public, anon;
grant execute on function public.staff_door_payment(uuid, boolean) to authenticated;

-- ── THE HOOK-IN POINT FOR A PROVIDER WEBHOOK ──
-- A future Edge Function (e.g. supabase/functions/payment-webhook) receives the provider's server-to-server callback,
-- verifies its signature with the provider's secret, reads OUR registration id from the custom field we passed on the
-- payment link (Grow cField, Cardcom ReturnValue, PayPlus more_info, Tranzila a custom parameter), and calls this with
-- the service role. Idempotent: a retried callback for a registration that is already paid changes nothing. It records
-- the money even when the registration was cancelled meanwhile (the team then refunds from the office).
-- Not exposed: the private schema is not served by the API. The Edge Function reaches it through a thin public wrapper
-- granted to service_role only (the pattern of public.service_rate_limit), added together with the integration.
create or replace function private.mark_paid_by_provider(p_registration_id uuid, p_amount numeric, p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_ref text := private.clean_text(p_ref, 100);
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if v_ref is null then
    raise exception 'invalid_ref' using errcode = 'P0001';
  end if;
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_reg.payment_status = 'paid' then
    return jsonb_build_object('registration_id', v_reg.id, 'payment_status', 'paid', 'already', true,
                              'same_ref', v_reg.payment_ref is not distinct from v_ref);
  end if;
  return private.write_payment(v_reg.id, 'paid', round(p_amount, 2), now(), 'card', v_ref);
end $$;
revoke execute on function private.mark_paid_by_provider(uuid, numeric, text) from public, anon, authenticated;
grant execute on function private.mark_paid_by_provider(uuid, numeric, text) to service_role;

-- ───────────── finance ─────────────

-- One meeting's money. Income: expected = collected + what registered people still owe (pending × price); a pending
-- waitlisted row, a pending no-show and a cancelled row owe nothing. Collected counts every 'paid' row, also one that
-- cancelled after paying (the money is in until it is refunded). Expenses come from event_payments (what is owed to
-- suppliers and the speaker). Net = collected − expenses paid; projected net = expected − all expenses.
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
      count(*) filter (where x.payment_status = 'waived' and x.status <> 'cancelled')::int as waived_count,
      count(*) filter (where x.payment_status = 'refunded')::int as refunded_count,
      coalesce(sum(x.paid_amount) filter (where x.payment_status = 'refunded'), 0) as refunded_amount
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
revoke execute on function private.event_finance(uuid) from public, anon, authenticated;

create or replace function public.staff_event_finance(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  perform private.assert_role('admin', 'coordinator');
  v_out := private.event_finance(p_event_id);
  if v_out is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_out;
end $$;
revoke execute on function public.staff_event_finance(uuid) from public, anon;
grant execute on function public.staff_event_finance(uuid) to authenticated;

-- Per meeting in a period, for the reports page. Not private.period_events: that one takes completed meetings only,
-- and money moves before a meeting (paid in advance, a deposit to a supplier). Here: every meeting in the period that is
-- not a draft and has money in it (a price, an expense or a payment); a cancelled one only while money is in it.
create or replace function public.staff_finance_summary(p_from date, p_to date, p_type text default null, p_site uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'invalid_date' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', e.id, 'starts_at', e.starts_at, 'title', e.title, 'type', e.type, 'status', e.status,
           'price', f -> 'price',
           'registered', (f ->> 'registered')::int,
           'paid_count', (f -> 'income' ->> 'paid_count')::int,
           'pending_count', (f -> 'income' ->> 'pending_count')::int,
           'collected', (f -> 'income' ->> 'collected')::numeric,
           'expected', (f -> 'income' ->> 'expected')::numeric,
           'expenses', (f -> 'expenses' ->> 'total')::numeric,
           'expenses_paid', (f -> 'expenses' ->> 'paid')::numeric,
           'net', (f ->> 'net')::numeric,
           'projected_net', (f ->> 'projected_net')::numeric)
         order by e.starts_at), '[]'::jsonb)
  into v_rows
  from public.events e
  cross join lateral (select private.event_finance(e.id) as f) x
  where e.status <> 'draft'
    and (p_type is null or e.type = p_type) and (p_site is null or e.site_id = p_site)
    and private.in_period(e.starts_at, p_from, p_to)
    and (coalesce(e.price, 0) > 0 or (f -> 'expenses' ->> 'count')::int > 0 or (f -> 'income' ->> 'collected')::numeric > 0)
    and (e.status <> 'cancelled' or (f -> 'expenses' ->> 'total')::numeric > 0 or (f -> 'income' ->> 'collected')::numeric > 0);

  return jsonb_build_object(
    'rows', v_rows,
    'totals', (
      select jsonb_build_object(
        'events', count(*)::int,
        'registered', coalesce(sum((x ->> 'registered')::int), 0),
        'paid_count', coalesce(sum((x ->> 'paid_count')::int), 0),
        'pending_count', coalesce(sum((x ->> 'pending_count')::int), 0),
        'collected', coalesce(sum((x ->> 'collected')::numeric), 0),
        'expected', coalesce(sum((x ->> 'expected')::numeric), 0),
        'expenses', coalesce(sum((x ->> 'expenses')::numeric), 0),
        'expenses_paid', coalesce(sum((x ->> 'expenses_paid')::numeric), 0),
        'net', coalesce(sum((x ->> 'net')::numeric), 0),
        'projected_net', coalesce(sum((x ->> 'projected_net')::numeric), 0))
      from jsonb_array_elements(v_rows) x));
end $$;
revoke execute on function public.staff_finance_summary(date, date, text, uuid) from public, anon;
grant execute on function public.staff_finance_summary(date, date, text, uuid) to authenticated;

-- the finance table can be exported from the reports page (logged like every other export)
create or replace function public.log_export(p_kind text, p_rows integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('admin', 'coordinator') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('participants', 'events', 'sources', 'presenters', 'monthly', 'followups', 'event_registrations', 'referrers', 'links', 'finance') then
    raise exception 'invalid_kind';
  end if;
  if p_kind in ('participants', 'event_registrations') and not private.has_role('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.audit_action('export', p_kind, null, jsonb_build_object('rows', greatest(0, least(p_rows, 1000000))));
end $$;

-- a copied meeting keeps its price, link and note (a draft: the team reviews it before opening)
create or replace function public.staff_duplicate_event(p_event_id uuid, p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.assert_role('admin', 'coordinator');
  if p_starts_at is null or p_starts_at < now() - interval '1 day' then
    raise exception 'invalid_date' using errcode = 'P0001';
  end if;
  insert into public.events (site_id, type, title, starts_at, ends_at, location, description, capacity, waitlist_enabled, status,
                             registration_closes_at, instructor_id, activity_name, price, payment_url, payment_note)
  select site_id, type, title, p_starts_at, p_starts_at + (ends_at - starts_at), location, description, capacity, waitlist_enabled, 'draft',
         case when registration_closes_at is not null then p_starts_at - (starts_at - registration_closes_at) end,
         instructor_id, activity_name, price, payment_url, payment_note
  from public.events where id = p_event_id
  returning id into v_id;
  if v_id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

-- the private helpers are reached only from the functions above (and triggers, which need no EXECUTE)
revoke execute on function private.registrations_payment_guard() from public, anon, authenticated;
revoke execute on function private.event_price_follow() from public, anon, authenticated;
revoke execute on function private.write_payment(uuid, text, numeric, timestamptz, text, text) from public, anon, authenticated;
