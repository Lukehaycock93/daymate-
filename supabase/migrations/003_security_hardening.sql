-- DAYMATE — Stage A security hardening (idempotent).
-- Trigger functions are never meant to be called through the API; their privilege
-- is only checked when the trigger is created, so revoking EXECUTE is safe.
revoke execute on function public.handle_new_user()            from public, anon, authenticated;
revoke execute on function public.dm_limit_notification_prefs() from public, anon, authenticated;
revoke execute on function public.dm_touch()                    from public, anon, authenticated;

-- dm_touch uses no tables: pin an empty search_path.
alter function public.dm_touch() set search_path = '';

-- is_premium() is only used inside server-side functions. Signed-in users read
-- their own plan from the entitlements table, so they don't need to call it
-- (which would let them look up other people's plans).
revoke execute on function public.is_premium(uuid) from public, anon, authenticated;
grant  execute on function public.is_premium(uuid) to service_role;
