-- A personal link for someone the team registered (an imported list, a phone call): the same #/m/<token> link
-- people get when they register themselves. Opening it once keeps the registration on their phone, so at the
-- door the permanent sign recognises them and check-in is one tap ("הגעתי").
-- The team sends it from their own WhatsApp (staff only; nothing is sent automatically). A new link replaces the
-- previous one of that registration (only a hash is stored, so an old link cannot be shown again).
-- Numbered before 20261106009000_privilege_hardening.sql; the grants are repeated here for databases where it ran.

create or replace function public.staff_personal_link(p_registration_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reg public.registrations;
  v_event public.events;
  v_token text;
begin
  perform private.assert_role('admin', 'coordinator');
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found or v_reg.status not in ('registered', 'waitlisted') then
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
end $$;

revoke execute on function public.staff_personal_link(uuid) from public, anon;
grant execute on function public.staff_personal_link(uuid) to authenticated;

-- A ready message for it (editable in Settings like every template). A service message, not marketing.
insert into public.message_templates (key, label, body, audience, is_marketing, sort_order)
values ('personal_link', 'קישור אישי לצ׳ק־אין מהיר',
'היי {שם_פרטי}, נרשמת ל{שם_המפגש} ב{תאריך} ב-{שעה}.
מקום: {מקום}
זה הקישור האישי שלך. כדאי לפתוח אותו פעם אחת כבר עכשיו, ואז בכניסה רק סורקים את הברקוד ולוחצים "הגעתי":
{קישור_אישי}
לא מסתדר לך להגיע? אפשר לבטל באותו קישור, כדי שהמקום יתפנה למי שמחכה.',
'registered', false, 15)
on conflict (key) do nothing;
