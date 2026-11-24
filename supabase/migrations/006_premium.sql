-- DAYMATE — Part 3: Premium subscriptions (RevenueCat), lifetime access, test plans (idempotent).
--
-- Who may change `entitlements`?  ONLY the service role (Edge Functions) or someone using the
-- Supabase SQL editor. Signed-in users can read their own row and nothing else.
--
--   * source = 'revenuecat' : written by the revenuecat-webhook / refresh-entitlement functions
--   * source = 'lifetime'   : permanent; no subscription event can ever change or remove it
--   * source = 'test'       : for testing only (see dm_set_test_plan); never touches lifetime rows

alter table public.entitlements drop constraint if exists entitlements_source_check;
alter table public.entitlements add constraint entitlements_source_check
  check (source in ('default', 'manual', 'stripe', 'revenuecat', 'lifetime', 'test'));

alter table public.entitlements
  add column if not exists store             text,                 -- app_store | play_store | stripe (RevenueCat Web Billing) | promotional
  add column if not exists product_id        text,
  add column if not exists will_renew        boolean,
  add column if not exists revenuecat_app_user_id text,
  add column if not exists last_event_ms     bigint not null default 0;   -- ignore older/out-of-order events

-- ---------------------------------------------------------------------------------------
-- Lifetime rows are untouchable by anything except a deliberate lifetime change.
-- Webhooks that try to downgrade a lifetime account are silently ignored (no error, no change).
-- ---------------------------------------------------------------------------------------
create or replace function public.dm_protect_lifetime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only the account itself being deleted (auth.users cascade) may remove a lifetime row.
    if old.source = 'lifetime' and exists (select 1 from auth.users u where u.id = old.user_id) then
      return null;
    end if;
    return old;
  end if;
  if old.source = 'lifetime' and new.source <> 'lifetime' then
    return old;                         -- keep the row exactly as it was
  end if;
  return new;
end;
$$;
drop trigger if exists dm_protect_lifetime_upd on public.entitlements;
create trigger dm_protect_lifetime_upd before update on public.entitlements
  for each row execute function public.dm_protect_lifetime();
drop trigger if exists dm_protect_lifetime_del on public.entitlements;
create trigger dm_protect_lifetime_del before delete on public.entitlements
  for each row execute function public.dm_protect_lifetime();

-- Lifetime rows never expire, whatever the date columns say.
create or replace function public.is_premium(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and e.plan = 'premium'
      and (
        e.source = 'lifetime'
        or (e.status in ('active', 'trialing') and (e.current_period_end is null or e.current_period_end > now()))
      )
  );
$$;
revoke all on function public.is_premium(uuid) from public, anon, authenticated;
grant execute on function public.is_premium(uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- Lifetime grant (admin only — runs from the SQL editor / migrations, never from the app)
-- ---------------------------------------------------------------------------------------
create or replace function public.dm_grant_lifetime(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'no such user %', p_user;
  end if;
  insert into public.entitlements (user_id, plan, status, source, store, current_period_end, will_renew, updated_at)
  values (p_user, 'premium', 'active', 'lifetime', 'promotional', null, false, now())
  on conflict (user_id) do update
    set plan = 'premium', status = 'active', source = 'lifetime', store = 'promotional',
        current_period_end = null, will_renew = false, updated_at = now();
end;
$$;
revoke all on function public.dm_grant_lifetime(uuid) from public, anon, authenticated;
grant execute on function public.dm_grant_lifetime(uuid) to service_role;

-- If a lifetime account is created again later (e.g. after a re-register with the same id is
-- impossible, but the grant list is kept for safety), this table lets the signup trigger re-apply it.
create table if not exists public.lifetime_grants (
  user_id    uuid primary key,          -- deliberately NOT a foreign key
  note       text,
  created_at timestamptz not null default now()
);
alter table public.lifetime_grants enable row level security;
revoke all on public.lifetime_grants from anon, authenticated;

create or replace function public.dm_apply_lifetime_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.lifetime_grants g where g.user_id = new.id) then
    perform public.dm_grant_lifetime(new.id);
  end if;
  return new;
end;
$$;
-- Runs after the standard signup trigger has created the entitlements row.
drop trigger if exists zz_dm_apply_lifetime on auth.users;
create trigger zz_dm_apply_lifetime after insert on auth.users
  for each row execute function public.dm_apply_lifetime_on_signup();
revoke all on function public.dm_apply_lifetime_on_signup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Test plans: flip any NON-lifetime account between Free and Premium to test the app.
--   select public.dm_set_test_plan('someone@example.com', 'premium');   -- or 'free'
-- Executable only by the service role / SQL editor.
-- ---------------------------------------------------------------------------------------
create or replace function public.dm_set_test_plan(p_email text, p_plan text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid; src text;
begin
  if p_plan not in ('free', 'premium') then raise exception 'plan must be free or premium'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'no such user'; end if;
  select source into src from public.entitlements where user_id = uid;
  if src = 'lifetime' then return 'refused: lifetime account'; end if;
  insert into public.entitlements (user_id, plan, status, source, current_period_end, updated_at)
  values (uid, p_plan, 'active', 'test', null, now())
  on conflict (user_id) do update set plan = p_plan, status = 'active', source = 'test', current_period_end = null, updated_at = now();
  return 'ok: ' || p_plan;
end;
$$;
revoke all on function public.dm_set_test_plan(text, text) from public, anon, authenticated;
grant execute on function public.dm_set_test_plan(text, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- Apply the lifetime entitlement to the owner's account (id supplied by the owner).
-- ---------------------------------------------------------------------------------------
insert into public.lifetime_grants (user_id, note) values ('0b271515-f8b4-4dc0-b31e-9319d40671b6', 'Owner lifetime Premium')
  on conflict do nothing;
select public.dm_grant_lifetime('0b271515-f8b4-4dc0-b31e-9319d40671b6');
