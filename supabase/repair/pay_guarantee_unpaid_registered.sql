-- READ-ONLY. NOT a migration and not applied anywhere automatically. (Migration 20261106002800_pay_guarantee.sql.)
--
-- Registrations that hold a confirmed place (or arrived) at a meeting with a fee without a recorded payment or waiver:
-- rows from before pay-first shipped (19.11.2026), like the public registration of 19.11 that is 'registered' with
-- payment_status 'pending'. Since 20261106002800 no new row like this can be created; existing ones are left as they are
-- until the team decides, one by one.
--
-- Run it in the SQL editor (it only reads):
select r.id                          as registration_id,
       e.title                       as meeting,
       e.starts_at,
       e.price,
       e.payment_url is not null     as has_payment_link,
       p.full_name,
       p.phone,
       r.status, r.attendance, r.payment_status,
       r.created_via, r.registered_at,
       (select a.actor_role from public.audit_log a
         where a.entity = 'registrations' and a.entity_id = r.id::text and a.action = 'insert'
         order by a.id limit 1)      as inserted_by_role,   -- 'public' = the anonymous form
       e.ends_at < now()             as meeting_over
from public.registrations r
join public.events e on e.id = r.event_id
left join public.participants p on p.id = r.participant_id
where coalesce(e.price, 0) > 0
  and (r.status = 'registered' or r.attendance = 'attended')
  and r.payment_status not in ('paid', 'waived')
order by e.starts_at, r.registered_at;

-- Suggested handling, per row, by the team (all from the app, each one audited):
--  • the meeting is ahead and the person did pay (a receipt in "יש חשבונית", Bit, a transfer):
--      registrations tab → "סימון תשלום" with the method and the receipt number (staff_set_payment 'paid').
--  • the meeting is ahead and nothing was paid: send the personal link to pay (WhatsApp from the row). If it is still
--      unpaid the day before, "סימון תשלום" → "לא שולם" moves it to waiting for payment (the place is released), or the
--      door takes cash at the entrance together with the arrival.
--  • a guest or a hardship case: "פטור מתשלום" with the reason.
--  • the meeting is over and the person came: record the payment if it was taken at the door, otherwise leave it as is
--      (history) and, if wanted, ask for the payment.
--  • the meeting is over and the person did not come: nothing to do (a no-show is not owed).
-- Nothing here changes data by itself; there is deliberately no bulk UPDATE.
