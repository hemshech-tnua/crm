-- DEMO ONLY: local demo and the hosted demo project, never production (run after demo-data.sql and demo-live.sql).
-- Fictitious association membership: most regulars are members, and a few people asked to join after a meeting
-- (each with the follow-up task the join form would have created). Runs once; touches only the demo phones.
do $$
declare
  p uuid;
begin
  if exists (select 1 from public.participants where membership <> 'none') then
    return;
  end if;
  update public.participants pa set membership = 'member',
         member_since = least(private.local_today(),
                              (select (min(e.starts_at) at time zone 'Asia/Jerusalem')::date + 14
                               from public.registrations r join public.events e on e.id = r.event_id
                               where r.participant_id = pa.id and r.attendance = 'attended'))
  where pa.phone like '+97250000%' and pa.anonymized_at is null
    and (select count(*) from public.registrations r where r.participant_id = pa.id and r.attendance = 'attended') >= 3;

  for p in select pa.id from public.participants pa
           where pa.phone like '+97250000%' and pa.anonymized_at is null and pa.membership = 'none'
             and exists (select 1 from public.registrations r where r.participant_id = pa.id and r.attendance = 'attended')
           order by pa.created_at desc limit 3 loop
    update public.participants set membership = 'requested', membership_requested_at = now() - interval '20 hours' where id = p;
    insert into public.follow_ups (participant_id, type, title, due_date, created_by)
    values (p, 'membership', 'ביקש/ה להצטרף לעמותה: לחזור עם פרטי ההצטרפות', private.local_today() + 2, null)
    on conflict do nothing;
  end loop;
end $$;
