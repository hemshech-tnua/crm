-- "כל הפרטים על המפגש" (19.11.2026): a public view of one meeting with the people who lead it. A visitor sees who
-- trains them and who lectures (photo, a short line, a few words), and what the lecture is about.
--
--  speakers.role_label      the chip on the person's card ("מרצה אורחת"), up to 30 characters
--  speakers.about           a few words for the meeting page, up to 600 characters
--  speakers.photo_path      the object path of the photo inside the public Storage bucket `people` (not a URL)
--  events.lecture_description  what the lecture is about, up to 600 characters
--
-- Photos live in Supabase Storage, never in the git repository: the repository is public and a person may withdraw
-- consent, while git history is permanent. Bucket `people` is public read (the photo is published on purpose, with
-- the person's consent), up to 2 MB, webp/jpeg/png only; only staff who manage speakers (admin, coordinator) may add,
-- replace or remove objects in it. The CSP allows images from exactly .../storage/v1/object/public/people/.
--
-- No new anonymous function: the public payload (private.event_public) only gains `lecture_description` and `people`,
-- built from approved speakers only, and never their phone, notes, social link or proposal. No new grants.
-- No personal content is seeded here: the texts and photos are entered by the team in production.
-- Written to be re-applied safely (if not exists, on conflict, drop … if exists, create or replace).

-- ───────────── columns ─────────────

alter table public.speakers
  add column if not exists role_label text
    constraint speakers_role_label_check check (char_length(role_label) <= 30),
  add column if not exists about text
    constraint speakers_about_check check (char_length(about) <= 600),
  add column if not exists photo_path text
    constraint speakers_photo_path_check check (photo_path ~ '^[a-z0-9][a-z0-9/_.-]{2,120}$' and photo_path !~ '\.\.');

alter table public.events
  add column if not exists lecture_description text
    constraint events_lecture_description_check check (char_length(lecture_description) <= 600);

-- the audit log records which fields changed (role_label, about, lecture_description appear in changed_fields without
-- their text); the photo's object path is kept as a value, so it is on record which photo was published and when
drop trigger if exists audit_speakers on public.speakers;
create trigger audit_speakers after insert or update or delete on public.speakers
  for each row execute function private.audit_row('kind', 'status', 'source', 'photo_path');

-- ───────────── what visitors see ─────────────

-- Every field of the previous payload stays as it was. New: `lecture_description`, and `people`, the approved
-- instructor and then the approved speaker:
--   { role: 'instructor' | 'speaker', name, label (role_label), line (bio_line), about, photo_path }
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
    'lecture_description', e.lecture_description,
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'role', p.role,
               'name', p.full_name,
               'label', p.role_label,
               'line', p.bio_line,
               'about', p.about,
               'photo_path', p.photo_path) order by p.ord), '[]'::jsonb)
      from (
        select 1 as ord, 'instructor' as role, i.full_name, i.role_label, i.bio_line, i.about, i.photo_path
        where i.status = 'approved'
        union all
        select 2, 'speaker', s.full_name, s.role_label, s.bio_line, s.about, s.photo_path
        where s.status = 'approved'
      ) p),
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

-- event_public is called only from inside the public_* security definer functions; nobody gets it directly
revoke execute on function private.event_public(uuid) from public, anon, authenticated;

-- ───────────── the photos (Supabase Storage, bucket `people`) ─────────────

-- Storage creates its schema itself (the hosted platform always; the local CLI when [storage] is enabled in
-- supabase/config.toml). Without it there is nothing to protect, so this part is skipped with a notice.
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found: bucket "people" and its policies were not created';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('people', 'people', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Public read of a single photo goes through /storage/v1/object/public/people/<path>, which needs no policy.
  -- Listing the bucket and every write are for staff who manage speakers only; anon and other signed-in users
  -- (the door team) match no policy and are refused.
  drop policy if exists people_staff_read on storage.objects;
  create policy people_staff_read on storage.objects for select to authenticated
    using (bucket_id = 'people' and (select private.has_role('admin', 'coordinator')));
  drop policy if exists people_staff_insert on storage.objects;
  create policy people_staff_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'people' and (select private.has_role('admin', 'coordinator')));
  drop policy if exists people_staff_update on storage.objects;
  create policy people_staff_update on storage.objects for update to authenticated
    using (bucket_id = 'people' and (select private.has_role('admin', 'coordinator')))
    with check (bucket_id = 'people' and (select private.has_role('admin', 'coordinator')));
  drop policy if exists people_staff_delete on storage.objects;
  create policy people_staff_delete on storage.objects for delete to authenticated
    using (bucket_id = 'people' and (select private.has_role('admin', 'coordinator')));
end $$;
