-- Event preparation and volunteers (from Itai's questionnaire, 16.11.2026). Preparing one meeting takes him 5–10
-- hours over two weeks, in a spreadsheet and WhatsApp; what weighs most is supplier payments, volunteers and setup,
-- and what gets forgotten is the small equipment. He asked for a ready checklist for every meeting and for booking
-- volunteers far ahead, the way coaches are booked.
--
--  prep_templates   the standing checklist per kind of meeting, after Itai's own "task warehouse" sheet: each task is
--                   due on a weekday of a week relative to the meeting's week ("two weeks before, Tuesday") or on
--                   the meeting day plus n days, with an estimate in hours and an optional fixed hour
--  suppliers        the standing suppliers and partners (food, venue, equipment), reused across meetings
--  event_tasks      a meeting's own checklist, copied from the templates when the meeting is created; due dates
--                   follow the meeting if its date moves
--  event_payments   what is owed to whom for a meeting: amount, invoice received, paid on
--  volunteers       the volunteer pool (name, phone, the roles they like)
--  volunteer_shifts who does what at which meeting: invited → confirmed / declined (by the volunteer, from a link)
--
-- Staff (admin, coordinator) work with the tables directly under RLS. A volunteer answers from a personal link
-- (#/v/<token>; only its hash is stored, a new link replaces the old one) through two public functions that see only
-- that volunteer's own upcoming shifts. Nothing is sent automatically: the team sends links and reminders from their
-- own WhatsApp. Numbered before 20261106009000_privilege_hardening.sql; grants are repeated here for databases where
-- it already ran.

create table public.prep_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('friday', 'bonfire', 'other', 'all')),
  kind text not null default 'task' check (kind in ('task', 'equipment')),
  category text not null default 'general'
    check (category in ('venue', 'program', 'food', 'equipment', 'marketing', 'registrations', 'volunteers', 'payments', 'setup', 'after', 'general')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  -- when: a weekday (0 = Sunday … 6 = Saturday) of the week `week_offset` weeks from the meeting's week, or, with no
  -- weekday, the meeting day plus `day_offset` days
  week_offset int not null default 0 check (week_offset between -12 and 8),
  weekday int check (weekday between 0 and 6),
  day_offset int not null default 0 check (day_offset between -60 and 30),
  fixed_time time,
  hours numeric(4, 2) check (hours is null or hours between 0 and 24),
  notes text check (char_length(notes) <= 300),
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  template_id uuid references public.prep_templates(id) on delete set null,
  kind text not null default 'task' check (kind in ('task', 'equipment')),
  category text not null default 'general'
    check (category in ('venue', 'program', 'food', 'equipment', 'marketing', 'registrations', 'volunteers', 'payments', 'setup', 'after', 'general')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  due_date date,
  due_time time,
  -- moved by hand: it keeps its date when the meeting moves (Itai's "manual date")
  due_manual boolean not null default false,
  hours numeric(4, 2) check (hours is null or hours between 0 and 24),
  assignee_id uuid references auth.users(id) on delete set null,
  notes text check (char_length(notes) <= 500),
  sort_order int not null default 100,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_tasks_event_idx on public.event_tasks (event_id, kind, sort_order);
create index event_tasks_open_idx on public.event_tasks (due_date) where done_at is null;
create unique index event_tasks_one_per_template on public.event_tasks (event_id, template_id) where template_id is not null;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  what text check (char_length(what) <= 120),
  contact_name text check (char_length(contact_name) <= 80),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  cost_note text check (char_length(cost_note) <= 120),
  notes text check (char_length(notes) <= 500),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier text not null check (char_length(btrim(supplier)) between 2 and 80),
  description text check (char_length(description) <= 160),
  amount numeric(10, 2) check (amount is null or amount between 0 and 1000000),
  due_date date,
  invoice_received boolean not null default false,
  paid_on date,
  notes text check (char_length(notes) <= 300),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_payments_event_idx on public.event_payments (event_id);
create index event_payments_open_idx on public.event_payments (due_date) where paid_on is null;

create table public.volunteers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  roles text[] not null default '{}' check (roles <@ array['entrance', 'food', 'setup', 'teardown', 'photo', 'other']),
  notes text check (char_length(notes) <= 500),
  is_active boolean not null default true,
  link_token_hash bytea unique,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index volunteers_active_idx on public.volunteers (is_active, full_name);

create table public.volunteer_shifts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  role text not null check (role in ('entrance', 'food', 'setup', 'teardown', 'photo', 'other')),
  status text not null default 'invited' check (status in ('invited', 'confirmed', 'declined', 'cancelled')),
  responded_at timestamptz,
  notes text check (char_length(notes) <= 300),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volunteer_shifts_one unique (event_id, volunteer_id, role)
);
create index volunteer_shifts_volunteer_idx on public.volunteer_shifts (volunteer_id, status);
create index volunteer_shifts_event_idx on public.volunteer_shifts (event_id, role);

-- updated_at, as on every other table
create trigger prep_templates_updated before update on public.prep_templates for each row execute function private.set_updated_at();
create trigger event_tasks_updated before update on public.event_tasks for each row execute function private.set_updated_at();
create trigger suppliers_updated before update on public.suppliers for each row execute function private.set_updated_at();
create trigger event_payments_updated before update on public.event_payments for each row execute function private.set_updated_at();
create trigger volunteers_updated before update on public.volunteers for each row execute function private.set_updated_at();
create trigger volunteer_shifts_updated before update on public.volunteer_shifts for each row execute function private.set_updated_at();

-- audit: money and people (the volunteer's phone is never copied into the log, only which fields changed)
create trigger audit_event_payments after insert or update or delete on public.event_payments
  for each row execute function private.audit_row('event_id', 'invoice_received', 'paid_on');
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function private.audit_row('is_active');
create trigger audit_volunteers after insert or update or delete on public.volunteers
  for each row execute function private.audit_row('is_active');
create trigger audit_volunteer_shifts after insert or update or delete on public.volunteer_shifts
  for each row execute function private.audit_row('event_id', 'role', 'status');

-- ── RLS: admin and coordinator only; the door team and visitors see none of it ──
do $$
declare t text;
begin
  foreach t in array array['prep_templates', 'event_tasks', 'suppliers', 'event_payments', 'volunteers', 'volunteer_shifts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                     using ((select private.has_role('admin', 'coordinator')))
                     with check ((select private.has_role('admin', 'coordinator')))$p$, t || '_staff', t);
  end loop;
end $$;
-- the link hash is never readable, not even by staff
revoke select on public.volunteers from authenticated;
grant select (id, full_name, phone, roles, notes, is_active, created_by, created_at, updated_at) on public.volunteers to authenticated;
revoke update on public.volunteers from authenticated;
grant update (full_name, phone, roles, notes, is_active) on public.volunteers to authenticated;
-- a task's done stamp is the caller's, set by the database
create or replace function private.event_task_done_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  return new;
end $$;
create trigger event_tasks_done_stamp before insert or update of done_at on public.event_tasks
  for each row execute function private.event_task_done_stamp();

-- ── a meeting's checklist from the templates ──
create or replace function private.prep_due(p_event_day date, p_week int, p_weekday int, p_day int)
returns date language sql immutable set search_path = '' as $$
  select case when p_weekday is null then p_event_day + p_day
              else p_event_day - extract(dow from p_event_day)::int + 7 * p_week + p_weekday end
$$;

create or replace function private.event_prep_from_templates(p_event_id uuid)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.event_tasks (event_id, template_id, kind, category, title, due_date, due_time, hours, notes, sort_order, created_by)
  select e.id, t.id, t.kind, t.category, t.title,
         private.prep_due((e.starts_at at time zone 'Asia/Jerusalem')::date, t.week_offset, t.weekday, t.day_offset),
         t.fixed_time, t.hours, t.notes, t.sort_order, null
  from public.events e
  join public.prep_templates t on t.is_active and t.event_type in (e.type, 'all')
  where e.id = p_event_id and e.status <> 'cancelled'
  on conflict (event_id, template_id) where template_id is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function private.event_prep_on_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.event_prep_from_templates(new.id);
  return null;
end $$;
create trigger events_prep_checklist after insert on public.events
  for each row execute function private.event_prep_on_insert();

-- when the meeting moves, its open tasks move with it: from their template where they have one (so "Tuesday" stays a
-- Tuesday), otherwise by the same number of days. Done tasks and tasks moved by hand keep their date.
create or replace function private.event_prep_on_move()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old date := (old.starts_at at time zone 'Asia/Jerusalem')::date;
  v_new date := (new.starts_at at time zone 'Asia/Jerusalem')::date;
begin
  if v_new <> v_old then
    update public.event_tasks k
    set due_date = coalesce(private.prep_due(v_new, t.week_offset, t.weekday, t.day_offset), k.due_date + (v_new - v_old))
    from public.event_tasks k2 left join public.prep_templates t on t.id = k2.template_id
    where k.id = k2.id and k.event_id = new.id and k.done_at is null and not k.due_manual and k.due_date is not null;
  end if;
  return null;
end $$;
create trigger events_prep_follow_date after update of starts_at on public.events
  for each row execute function private.event_prep_on_move();

-- for meetings created before this feature, or after the templates changed: adds what is missing, never duplicates
create or replace function public.staff_prep_init(p_event_id uuid)
returns int language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.assert_role('admin', 'coordinator');
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return private.event_prep_from_templates(p_event_id);
end $$;
revoke execute on function public.staff_prep_init(uuid) from public, anon;
grant execute on function public.staff_prep_init(uuid) to authenticated;

-- ── volunteers' personal link ──
create or replace function public.staff_volunteer_link(p_volunteer_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_token text;
begin
  perform private.assert_role('admin', 'coordinator');
  if not exists (select 1 from public.volunteers where id = p_volunteer_id and is_active) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  v_token := private.new_token();
  update public.volunteers set link_token_hash = private.token_hash(v_token) where id = p_volunteer_id;
  perform private.audit_action('volunteer_link', 'volunteers', p_volunteer_id::text, null);
  return v_token;
end $$;
revoke execute on function public.staff_volunteer_link(uuid) from public, anon;
grant execute on function public.staff_volunteer_link(uuid) to authenticated;

create or replace function private.volunteer_by_token(p_token text)
returns public.volunteers language sql stable security definer set search_path = '' as $$
  select * from public.volunteers where link_token_hash = private.token_hash(p_token) and is_active
$$;

-- what a volunteer sees: their first name and their upcoming shifts (nothing about anyone else)
create or replace function public.public_volunteer(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.volunteers;
begin
  perform private.rate_limit('vol-ip:' || private.client_key(), 60, 3600);
  v := private.volunteer_by_token(p_token);
  if v.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'first_name', split_part(btrim(v.full_name), ' ', 1),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'role', s.role, 'status', s.status,
               'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'location', e.location)
             order by e.starts_at, s.role)
      from public.volunteer_shifts s join public.events e on e.id = s.event_id
      where s.volunteer_id = v.id and s.status in ('invited', 'confirmed', 'declined')
        and e.ends_at > now() and e.status not in ('cancelled', 'completed')), '[]'::jsonb));
end $$;

create or replace function public.public_volunteer_respond(p_token text, p_shift_id uuid, p_answer text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.volunteers;
  v_status text;
begin
  perform private.rate_limit('vol-ip:' || private.client_key(), 60, 3600);
  if p_answer not in ('confirmed', 'declined') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v := private.volunteer_by_token(p_token);
  if v.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.volunteer_shifts s set status = p_answer, responded_at = now()
  from public.events e
  where s.id = p_shift_id and s.volunteer_id = v.id and e.id = s.event_id
    and s.status in ('invited', 'confirmed', 'declined') and e.ends_at > now() and e.status not in ('cancelled', 'completed')
  returning s.status into v_status;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_status;
end $$;

revoke execute on function public.public_volunteer(text) from public;
revoke execute on function public.public_volunteer_respond(text, uuid, text) from public;
grant execute on function public.public_volunteer(text) to anon, authenticated;
grant execute on function public.public_volunteer_respond(text, uuid, text) to anon, authenticated;

-- ── the standing checklist (editable in Settings), from Itai's "task warehouse" (names of people left out) ──
-- weekday: 0 א׳ … 5 ו׳; week_offset: -2 two weeks before, -1 the week before, 0 the meeting's week, 1 the week after
insert into public.prep_templates (event_type, kind, category, title, week_offset, weekday, day_offset, fixed_time, hours, notes, sort_order) values
  ('friday', 'task', 'program', 'סגירת מרצה ונושא: שם, תמונה ושתי שורות תיאור', -2, 2, 0, null, 1, null, 10),
  ('friday', 'task', 'program', 'אישור מאמן ואימון מול רכז המאמנים', -2, 2, 0, null, 0.25, null, 20),
  ('friday', 'task', 'marketing', 'שליחת פרטי המרצה לעיצוב הפלייר', -2, 2, 0, null, 0.25, null, 30),
  ('friday', 'task', 'registrations', 'פתיחת המפגש במערכת: קישור הרשמה וברקוד', -2, 3, 0, null, 0.5, null, 40),
  ('friday', 'task', 'marketing', 'פרסום בוואטסאפ ובאינסטגרם עם קישור ההרשמה', -1, 0, 0, null, 1, null, 50),
  ('friday', 'task', 'volunteers', 'גיוס מתנדב לקבלת פנים (עדיף לכמה מפגשים מראש)', -1, 2, 0, null, 0.5, null, 60),
  ('friday', 'task', 'marketing', 'הזמנות אישיות לכ-10 אנשים לפי הנושא, עם דגש על לוחמות', -1, 3, 0, null, 1.5, null, 70),
  ('friday', 'task', 'food', 'בדיקת מספר הנרשמים והזמנת אוכל', 0, 3, 0, null, 0.5, null, 80),
  ('friday', 'task', 'registrations', 'תזכורת בקבוצה ותיאום אחרון עם המרצה והמאמן', 0, 4, 0, null, 0.5, null, 90),
  ('friday', 'task', 'equipment', 'אריזת ציוד לפי רשימת הציוד', 0, 4, 0, null, 0.5, null, 100),
  ('friday', 'task', 'setup', 'הקמה, מפגש ופירוק: צ׳ק־אין, צילום, הזמנה למפגש הבא', 0, null, 0, '08:15', 3.75, '08:15 הקמה · 09:00–11:30 מפגש · פירוק עד 12:00', 110),
  ('friday', 'task', 'after', 'הודעת תודה עם תמונה וקישור למפגש הבא', 0, null, 0, '12:00', 0.5, null, 120),
  ('friday', 'task', 'after', 'שליחת משוב למשתתפים מהמערכת', 1, 1, 0, null, 0.25, null, 130),
  ('friday', 'task', 'after', 'שיחות אישיות: 3 שנרשמו ולא הגיעו ו-3 חדשים', 1, 1, 0, null, 1.5, null, 140),
  ('friday', 'task', 'payments', 'תשלום לספקים ולמרצה', 1, 2, 0, null, 0.5, null, 150),
  ('friday', 'task', 'marketing', 'העלאת תמונות לאינסטגרם', 1, 2, 0, null, 0.5, null, 160),
  ('friday', 'task', 'after', 'סיכום קצר מהמערכת: 3 מספרים ותובנה אחת', 1, 2, 0, null, 0.25, null, 170),
  ('bonfire', 'task', 'venue', 'אישור מקום וספקים קבועים: כיבוד, בירות, עצים', -2, 2, 0, null, 1, null, 10),
  ('bonfire', 'task', 'marketing', 'עדכון הפלייר מול המעצב', -2, 2, 0, null, 0.25, null, 20),
  ('bonfire', 'task', 'registrations', 'פתיחת האירוע במערכת', -2, 3, 0, null, 0.5, null, 30),
  ('bonfire', 'task', 'marketing', 'פרסום בוואטסאפ ובאינסטגרם, ובקשה להעביר לחברים', -1, 0, 0, null, 1, null, 40),
  ('bonfire', 'task', 'volunteers', 'גיוס 2 מתנדבים: קליטה, מדורה וצילום', -1, 2, 0, null, 0.5, null, 50),
  ('bonfire', 'task', 'marketing', 'הזמנות אישיות: מי שהגיע למפגש שישי ומביא חבר', -1, 3, 0, null, 1, null, 60),
  ('bonfire', 'task', 'food', 'בדיקת נרשמים, כמויות וקניות: עצים, כוסות, פנסים, דלי מים', 0, 2, 0, null, 2, null, 70),
  ('bonfire', 'task', 'registrations', 'תזכורת אחרונה ושליחת מיקום מדויק', 0, 3, 0, null, 0.25, null, 80),
  ('bonfire', 'task', 'setup', 'הקמה, אירוע, כיבוי מלא ופירוק', 0, null, 0, '17:30', 4, null, 90),
  ('bonfire', 'task', 'after', 'הודעת תודה עם תמונה והזמנה למפגש השישי הקרוב', 0, null, 1, '10:00', 0.5, null, 100),
  ('bonfire', 'task', 'after', 'הזמנה אישית לחדשים למפגש השישי הקרוב', 1, 3, 0, null, 1, null, 110),
  ('bonfire', 'task', 'after', 'סיכום מהמערכת: נרשמו, הגיעו, חדשים', 1, 2, 0, null, 0.25, null, 120),
  ('other', 'task', 'program', 'סגירת מרצה או מנחה ונושא', -2, 2, 0, null, 1, null, 10),
  ('other', 'task', 'registrations', 'פתיחת המפגש במערכת', -2, 3, 0, null, 0.5, null, 20),
  ('other', 'task', 'marketing', 'פרסום בוואטסאפ ובאינסטגרם', -1, 0, 0, null, 1, null, 30),
  ('other', 'task', 'volunteers', 'גיוס מתנדבים', -1, 2, 0, null, 0.5, null, 40),
  ('other', 'task', 'food', 'בדיקת נרשמים והזמנת אוכל', 0, 3, 0, null, 0.5, null, 50),
  ('other', 'task', 'registrations', 'תזכורת לנרשמים', 0, 4, 0, null, 0.25, null, 60),
  ('other', 'task', 'equipment', 'אריזת ציוד לפי רשימת הציוד', 0, 4, 0, null, 0.5, null, 70),
  ('other', 'task', 'setup', 'הקמה, מפגש ופירוק', 0, null, 0, null, 3, null, 80),
  ('other', 'task', 'after', 'הודעת תודה עם תמונה', 0, null, 1, null, 0.5, null, 90),
  ('other', 'task', 'payments', 'תשלום לספקים', 1, 2, 0, null, 0.5, null, 100),
  ('other', 'task', 'after', 'סיכום מהמערכת', 1, 2, 0, null, 0.25, null, 110),
  -- the small equipment that is easiest to forget (packed with the "packing" task)
  ('all', 'equipment', 'equipment', 'כבל מאריך ומפצל', 0, 4, 0, null, null, null, 200),
  ('all', 'equipment', 'equipment', 'קפסולות קפה', 0, 4, 0, null, null, null, 210),
  ('all', 'equipment', 'equipment', 'מקרן וכבל HDMI', 0, 4, 0, null, null, null, 220),
  ('all', 'equipment', 'equipment', 'מפות שולחן', 0, 4, 0, null, null, null, 230),
  ('all', 'equipment', 'equipment', 'תגי שם וטוש', 0, 4, 0, null, null, null, 240),
  ('all', 'equipment', 'equipment', 'שלט הברקוד, מודפס', 0, 4, 0, null, null, null, 250),
  ('all', 'equipment', 'equipment', 'רמקול', 0, 4, 0, null, null, null, 260),
  ('all', 'equipment', 'equipment', 'שקיות זבל', 0, 4, 0, null, null, null, 270),
  ('all', 'equipment', 'equipment', 'ערכת עזרה ראשונה', 0, 4, 0, null, null, null, 280),
  ('friday', 'equipment', 'equipment', 'מזרני יוגה', 0, 4, 0, null, null, null, 290),
  ('bonfire', 'equipment', 'equipment', 'עצים ומצית', 0, 2, 0, null, null, null, 290),
  ('bonfire', 'equipment', 'equipment', 'כוסות ופנסים', 0, 2, 0, null, null, null, 300),
  ('bonfire', 'equipment', 'equipment', 'דלי מים לכיבוי', 0, 2, 0, null, null, null, 310);
