-- Sign-in with phone + password (until email codes or SMS are set up). The staff-admin Edge Function looks up the
-- staff member by phone and signs them in with their password; it limits attempts per phone and per caller through
-- this function, which only the service role may call.
create or replace function public.service_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.rate_limit(p_bucket, p_limit, p_window_seconds);
end $$;
revoke execute on function public.service_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.service_rate_limit(text, int, int) to service_role;
