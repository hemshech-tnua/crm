-- Defense in depth: Supabase grants EXECUTE on new functions to anon and authenticated through global
-- default privileges, which a per-schema revoke cannot override. Every function already checks the
-- caller's role itself, but the anonymous surface should be exactly the public_* endpoints.
-- Keep this migration LAST (numbered 9000 so later fixes come before it); tests/api/security.test.ts pins the anonymous surface.

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
-- triggers and RLS policies run helpers in the private schema as the signed-in user; the schema is not
-- exposed through the API, so this grant does not make any of them callable from outside
grant execute on all functions in schema private to authenticated;

grant execute on function public.public_list_events() to anon;
grant execute on function public.public_get_event(text, text) to anon;
grant execute on function public.public_sources() to anon;
grant execute on function public.public_register(jsonb) to anon;
grant execute on function public.public_registration(text) to anon;
grant execute on function public.public_cancel(text, text) to anon;
grant execute on function public.public_checkin_info(text) to anon;
grant execute on function public.public_checkin(jsonb) to anon;
grant execute on function public.public_walkin(jsonb) to anon;
grant execute on function public.public_feedback_context(jsonb) to anon;
grant execute on function public.public_submit_feedback(jsonb) to anon;
grant execute on function public.public_propose(jsonb) to anon;
grant execute on function public.public_org_info() to anon;
grant execute on function public.public_checkin_undo(text) to anon;

-- the stats views are for signed-in staff only
revoke all on public.participant_stats, public.event_stats from anon, public;

-- future functions: no automatic EXECUTE for anon (applies to objects created by this role)
alter default privileges revoke execute on functions from public;
alter default privileges revoke execute on functions from anon;
