-- DEMO DATA ONLY. Fictitious people and meetings for development, screenshots, user simulations and the
-- separate hosted demo project (hemshech-tnua-demo). Never run against the production project.
-- Run:  psql "$LOCAL_DB_URL" -f supabase/demo-data.sql
-- Every name here is invented. Phones are in the 050-000xxxx range.
do $$
declare
  site uuid := '00000000-0000-4000-8000-000000000001';
  firsts text[] := array['נועם','יואב','מאיה','איתמר','שירה','עומר','דניאל','תמר','אורי','רוני','גיא','נטע','אביב','הדר','ליאור','עדי','יונתן','נוי','אלון','מיכל','רועי','שקד','איתן','ענבר','בן','יעל','עידו','רז','אסף','גל'];
  lasts text[] := array['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','פרידמן','שפירא','גולן','ברק','אזולאי','דהן','חדד','רוזן','קפלן','שגיא','טל','בר','אלמוג','נחום'];
  cities text[] := array['מודיעין','מודיעין','מודיעין','מכבים-רעות','לוד','רמלה','שהם','ירושלים','תל אביב','רחובות','מבשרת ציון','כפר האורנים'];
  src_keys text[] := array['instagram','instagram','whatsapp_group','whatsapp_group','whatsapp_group','friend','friend','friend','facebook','organization','other'];
  speakers uuid[] := '{}';
  topics text[] := array['חוסן אחרי מילואים','לחזור לעבודה אחרי סבב ארוך','זוגיות ומילואים','שינה, נשימה ומה שביניהן','איך מדברים עם הילדים','יזמות אחרי השירות','ספורט כדרך חיים','כסף, זכויות ומענקים'];
  names text[] := array['ד״ר רונן אלקיים','מיכל ברנע','אבי שטרן','נגה פלד','יוסי חזן','דנה וולף','עמית ריכטר','שרון גבאי'];
  yoga uuid;
  pilates uuid;
  ev uuid;
  evs uuid[] := '{}';
  p uuid;
  ps uuid[] := '{}';
  propensity numeric[] := '{}';
  i int;
  w int;
  d date;
  starts timestamptz;
  r record;
  v_src text;
  v_att text;
  fri date := (date_trunc('week', (now() at time zone 'Asia/Jerusalem')::date)::date + 4); -- this week's Friday
begin
  perform setseed(0.42);
  perform set_config('app.trusted', 'on', true);

  for i in 1..8 loop
    insert into public.speakers (kind, full_name, topic, bio_line, phone, status, source, created_by)
    values ('speaker', names[i], topics[i], 'מרצה אורח/ת (דמו)', '+97250000' || lpad((900 + i)::text, 4, '0'), 'proposed', 'staff', null)
    returning id into p;
    update public.speakers set status = 'approved' where id = p;
    speakers := speakers || p;
  end loop;
  insert into public.speakers (kind, full_name, topic, status, created_by) values ('instructor', 'קרן יוגה (דמו)', 'יוגה', 'proposed', null) returning id into yoga;
  update public.speakers set status = 'approved' where id = yoga;
  insert into public.speakers (kind, full_name, topic, status, created_by) values ('instructor', 'שי פילאטיס (דמו)', 'פילאטיס', 'proposed', null) returning id into pilates;
  update public.speakers set status = 'approved' where id = pilates;
  insert into public.speakers (kind, full_name, topic, bio_line, phone, status, source, proposal_message, created_by)
  values ('speaker', 'אלה מזרחי (דמו)', 'מוזיקה כדרך לעבד חוויות', 'מוזיקאית ומטפלת', '+972500000951', 'proposed', 'public_form', 'שמעתי עליכם מחבר, אשמח להתנדב להרצאה', null);

  -- 70 participants with a stable "how often they come" propensity
  for i in 1..70 loop
    v_src := src_keys[1 + floor(random() * array_length(src_keys, 1))::int];
    insert into public.participants (full_name, phone, city, birth_year, first_source_id, created_via, consent_updates, photo_opt_out, created_at)
    values (
      firsts[1 + floor(random() * array_length(firsts, 1))::int] || ' ' || lasts[1 + floor(random() * array_length(lasts, 1))::int],
      '+97250000' || lpad(i::text, 4, '0'),
      cities[1 + floor(random() * array_length(cities, 1))::int],
      (2026 - 22 - floor(random() * 25))::smallint,
      (select id from public.acquisition_sources where key = v_src),
      'registration', random() < 0.7, random() < 0.08,
      now() - make_interval(days => 80 - i)
    ) returning id into p;
    ps := ps || p;
    propensity := propensity || (case when random() < 0.25 then 0.75 when random() < 0.5 then 0.35 else 0.12 end)::numeric;
  end loop;
  -- friend referrals: some participants were brought by an earlier one
  update public.participants x set referred_by_participant_id = ps[1 + floor(random() * 20)::int]
  from public.acquisition_sources s
  where s.id = x.first_source_id and s.is_friend and x.id = any (ps[21:70]) and random() < 0.7;

  -- ten weeks back: Fridays 09:00–11:30, every fourth week a bonfire evening instead
  for w in reverse 10..1 loop
    d := fri - (w * 7);
    if w % 4 = 0 then
      starts := (d - 1 + time '19:30') at time zone 'Asia/Jerusalem';
      insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name)
      values (site, 'bonfire', 'ערב מדורה', starts, starts + interval '2.5 hours', 'החורשה ליד הולמס פלייס', 60, 'open', null)
      returning id into ev;
    else
      starts := (d + time '09:00') at time zone 'Asia/Jerusalem';
      insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id, speaker_id, lecture_topic)
      values (site, 'friday', 'מפגש שישי', starts, starts + interval '2.5 hours', 'הולמס פלייס מודיעין', 40, 'open',
              case when w % 2 = 0 then 'יוגה' else 'פילאטיס' end, case when w % 2 = 0 then yoga else pilates end,
              speakers[1 + (w % 8)], topics[1 + (w % 8)])
      returning id into ev;
    end if;
    evs := evs || ev;

    -- people join over time: only those created before the event
    for i in 1..70 loop
      continue when i > 18 + (10 - w) * 6;
      continue when random() > propensity[i] * (case when w % 4 = 0 then 0.6 else 1 end);
      v_att := case when random() < 0.82 then 'attended' else 'no_show' end;
      insert into public.registrations (event_id, participant_id, status, attendance, is_walk_in, registered_at, checked_in_at, checkin_method,
                                        how_heard_source_id, created_via)
      values (ev, ps[i], 'registered', v_att, v_att = 'attended' and random() < 0.07,
              starts - make_interval(days => 1 + floor(random() * 6)::int),
              case when v_att = 'attended' then starts + make_interval(mins => floor(random() * 40)::int - 10) end,
              case when v_att = 'attended' then (case when random() < 0.7 then 'self_qr' else 'staff' end) end,
              (select first_source_id from public.participants where id = ps[i]), 'public_form');
    end loop;
    -- a few cancellations
    update public.registrations set status = 'cancelled', attendance = 'unknown', checked_in_at = null, checkin_method = null,
           cancelled_at = starts - interval '1 day', cancelled_by = 'participant'
    where event_id = ev and attendance = 'no_show' and random() < 0.3;
    update public.events set status = 'completed' where id = ev;

    -- feedback from about half of those who came
    insert into public.feedback (event_id, registration_id, participant_id, overall_rating, activity_rating, lecture_rating, comment, source, created_at)
    select ev, r2.id, r2.participant_id,
           least(5, greatest(2, round(4.2 + (random() - 0.5) * 2)))::int,
           case when w % 4 <> 0 then least(5, greatest(1, round(4 + (random() - 0.5) * 2)))::int end,
           case when w % 4 <> 0 then least(5, greatest(1, round(3.9 + (random() - 0.5) * 2.4)))::int end,
           case when random() < 0.25 then (array['היה מעולה, תודה!','ההרצאה הייתה מרתקת','אשמח לעוד יוגה','הארוחה הייתה מושלמת','קצת צפוף, אבל אווירה טובה'])[1 + floor(random() * 5)::int] end,
           'personal_link', starts + interval '4 hours'
    from public.registrations r2 where r2.event_id = ev and r2.attendance = 'attended' and random() < 0.55;
  end loop;

  -- open follow-ups for no-shows of the last meeting
  insert into public.follow_ups (participant_id, event_id, type, title, due_date, created_by)
  select r3.participant_id, r3.event_id, 'no_show', 'נרשם/ה ולא הגיע/ה: הודעת "חסרת לנו" ושיחה', (now() at time zone 'Asia/Jerusalem')::date + 1, null
  from public.registrations r3 where r3.event_id = evs[array_length(evs, 1)] and r3.attendance = 'no_show'
  on conflict do nothing;

  -- next Friday: open for registration; the one after: a draft without a speaker yet
  starts := ((fri + case when (now() at time zone 'Asia/Jerusalem')::date > fri then 7 else 0 end) + time '09:00') at time zone 'Asia/Jerusalem';
  insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id, speaker_id, lecture_topic, description)
  values (site, 'friday', 'מפגש שישי', starts, starts + interval '2.5 hours', 'הולמס פלייס מודיעין', 40, 'open', 'יוגה', yoga, speakers[3], topics[3],
          'יוגה, הרצאת אורח, ארוחת בוקר וזמן ביחד. מתאים לכל רמה, מביאים בגדים נוחים.')
  returning id into ev;
  for i in 1..70 loop
    continue when random() > propensity[i] * 0.8;
    insert into public.registrations (event_id, participant_id, status, registered_at, how_heard_source_id, created_via)
    values (ev, ps[i], 'registered', now() - make_interval(hours => floor(random() * 100)::int),
            (select first_source_id from public.participants where id = ps[i]), 'public_form');
  end loop;
  insert into public.events (site_id, type, title, starts_at, ends_at, location, capacity, status, activity_name, instructor_id)
  values (site, 'friday', 'מפגש שישי', starts + interval '7 days', starts + interval '7 days 2.5 hours', 'הולמס פלייס מודיעין', 40, 'draft', 'פילאטיס', pilates);

  insert into public.referral_links (code, label, source_id, campaign, created_by)
  values ('ig-bio', 'ביו באינסטגרם', (select id from public.acquisition_sources where key = 'instagram'), null, null),
         ('wa-modiin', 'קבוצת המילואימניקים של מודיעין', (select id from public.acquisition_sources where key = 'whatsapp_group'), null, null)
  on conflict (code) do nothing;
  update public.registrations set referral_link_id = (select id from public.referral_links where code = 'ig-bio')
  where how_heard_source_id = (select id from public.acquisition_sources where key = 'instagram') and random() < 0.6;
end $$;
