-- Least privilege for the private schema (database review D7). 20261106009000 granted EXECUTE on every private function
-- to `authenticated`, which re-opened helpers that had been revoked on purpose (issue_device, device_participant,
-- patch_function…). The schema is not exposed over the API, so none of them was reachable, but only what RLS policies,
-- column defaults and functions that run as the caller actually use is granted now (found from the catalog on 15.11.2026).
-- Runs after 9000 on a fresh database too. A future private function used by a policy, a default or an invoker function
-- needs its own grant here.

revoke execute on all functions in schema private from authenticated;

grant execute on function private.has_role(variadic text[]) to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.assert_role(variadic text[]) to authenticated;
grant execute on function private.clean_text(text, integer) to authenticated;
grant execute on function private.normalize_phone(text) to authenticated;
grant execute on function private.local_today() to authenticated;
grant execute on function private.random_code(integer) to authenticated;
grant execute on function private.new_participant_code() to authenticated;
grant execute on function private.in_period(timestamptz, date, date) to authenticated;
grant execute on function private.period_events(date, date, text, uuid) to authenticated;
grant execute on function private.aftercare_ready() to authenticated;
grant execute on function private.name_mismatches() to authenticated;
