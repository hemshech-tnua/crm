-- LOCAL DEMO ONLY (run after demo-data.sql). Adds what makes the demo "live" whatever day it is run:
-- a demo meeting starting in an hour (to try QR check-in and the door list now), and this week's Friday as an
-- ended, not-yet-closed meeting (to try "סגירת המפגש") when that Friday has passed and is missing.
do $$
declare
  site uuid := '00000000-0000-4000-8000-000000000001';
  fri date := date_trunc('week', (now() at time zone 'Asia/Jerusalem')::date)::date + 4;
  starts timestamptz := (fri + time '09:00') at time zone 'Asia/Jerusalem';
  ev uuid;
  p record;
  n int := 0;
begin
  update public.settings set contact_phone = '+972527110055';

  insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, description)
  values (site, 'other', 'מפגש הדגמה (לניסוי צ׳ק־אין)', now() + interval '1 hour', now() + interval '3 hours',
          'הולמס פלייס מודיעין', 30, 'open', 'יוגה', 'מפגש בדוי לניסוי: צ׳ק־אין בכניסה ורשימת נוכחות.')
  returning id into ev;
  for p in select id, first_source_id from public.participants where phone like '+97250000%' order by phone limit 8 loop
    insert into public.registrations (event_id, participant_id, status, registered_at, how_heard_source_id, created_via)
    values (ev, p.id, 'registered', now() - make_interval(hours => 5 + n), p.first_source_id, 'public_form');
    n := n + 1;
  end loop;

  if starts + interval '2.5 hours' < now()
     and not exists (select 1 from public.events e where e.type = 'friday' and (e.starts_at at time zone 'Asia/Jerusalem')::date = fri) then
    insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id, speaker_id, lecture_topic)
    select site, 'friday', 'מפגש שישי', starts, starts + interval '2.5 hours', 'הולמס פלייס מודיעין', 40, 'open', 'פילאטיס',
           (select id from public.speakers where full_name like 'שי פילאטיס%'),
           (select id from public.speakers where kind = 'speaker' and status = 'approved' order by full_name limit 1), 'זוגיות ומילואים'
    returning id into ev;
    n := 0;
    for p in select pa.id, pa.first_source_id from public.participants pa join public.participant_stats ps on ps.participant_id = pa.id
             where pa.phone like '+97250000%' order by ps.attended_count desc, pa.phone limit 20 loop
      insert into public.registrations (event_id, participant_id, status, attendance, registered_at, checked_in_at, checkin_method, how_heard_source_id, created_via)
      values (ev, p.id, 'registered', case when n % 5 = 4 then 'unknown' else 'attended' end, starts - interval '3 days',
              case when n % 5 = 4 then null else starts + make_interval(mins => n) end,
              case when n % 5 = 4 then null when n % 3 = 0 then 'staff' else 'self_qr' end, p.first_source_id, 'public_form');
      n := n + 1;
    end loop;
  end if;
end $$;
