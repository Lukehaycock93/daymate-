-- DAYMATE — Part 3 follow-up: trigger helper must not be callable through the API.
revoke all on function public.dm_protect_lifetime() from public, anon, authenticated;
comment on table public.lifetime_grants is 'Server-only (RLS on, deliberately no policies): permanent Premium grants.';
