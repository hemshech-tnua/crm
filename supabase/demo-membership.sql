-- DEMO ONLY: local demo and the hosted demo project, never production (run after demo-data.sql and demo-live.sql).
-- Fictitious association membership, touching only the demo phones (+97250000…): about two thirds of the regulars
-- (3+ visits) are members, so every meeting also has non-members who get the invitation to join; and three people
-- asked to join after a meeting, each with the follow-up task the join form creates. Safe to run again.
do $$
declare
  p uuid;
begin
  update public.participants pa set membership = x.want,
         member_since = case when x.want = 'member' then x.since end
  from (
    select q.id,
           case when q.visits >= 3 and right(q.phone, 1)::int % 3 <> 0 then 'member' else 'none' end as want,
           least(private.local_today(), q.first_visit + 14) as since
    from (
      select pa2.id, pa2.phone,
             (select count(*) from public.registrations r where r.participant_id = pa2.id and r.attendance = 'attended') as visits,
             (select (min(e.starts_at) at time zone 'Asia/Jerusalem')::date
              from public.registrations r join public.events e on e.id = r.event_id
              where r.participant_id = pa2.id and r.attendance = 'attended') as first_visit
      from public.participants pa2
      where pa2.phone like '+97250000%' and pa2.anonymized_at is null and pa2.membership <> 'requested'
    ) q
  ) x
  where pa.id = x.id and pa.membership is distinct from x.want;

  if not exists (select 1 from public.participants where phone like '+97250000%' and membership = 'requested') then
    for p in select pa.id from public.participants pa
             where pa.phone like '+97250000%' and pa.anonymized_at is null and pa.membership = 'none'
               and exists (select 1 from public.registrations r where r.participant_id = pa.id and r.attendance = 'attended')
             order by pa.created_at desc limit 3 loop
      update public.participants set membership = 'requested', membership_requested_at = now() - interval '20 hours' where id = p;
      insert into public.follow_ups (participant_id, type, title, due_date, created_by)
      values (p, 'membership', 'ביקש/ה להצטרף לעמותה: לחזור עם פרטי ההצטרפות', private.local_today() + 2, null)
      on conflict do nothing;
    end loop;
  end if;
end $$;
