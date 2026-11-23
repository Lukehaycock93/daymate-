-- ==========================================================================
-- DAYMATE — Part 2 database schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
--
-- Principles
--   * Every table has Row Level Security ON. Users only ever see their own rows.
--   * Composite primary keys (user_id, id): the app creates UUIDs on the device,
--     and the same local data can safely be migrated into two different accounts.
--   * Soft deletes (deleted_at) so deletions sync between devices.
--   * Premium is decided ONLY by the `entitlements` table, which signed-in users
--     can read but never write. Only the service role (server / future Stripe
--     webhook) can change it.
--   * No private keys live here. VAPID private key + service-role key are
--     Edge Function secrets (see SETUP.md).
-- ==========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- Shared trigger: keeps sync bookkeeping honest
--   * ignores stale writes (an older device can't overwrite newer data)
--   * stamps synced_at on the server clock (used as the incremental pull cursor)
--   * user_id can never be changed after insert
-- --------------------------------------------------------------------------
create or replace function public.dm_touch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null;                       -- stale write: silently skip
    end if;
    new.user_id := old.user_id;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 30),
  timezone     text not null default 'Europe/London' check (char_length(timezone) between 1 and 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- entitlements (server-controlled; read-only for users)
-- --------------------------------------------------------------------------
create table if not exists public.entitlements (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free', 'premium')),
  status             text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  source             text not null default 'default' check (source in ('default', 'manual', 'stripe')),
  current_period_end timestamptz,
  stripe_customer_id text,          -- reserved for the Stripe stage
  updated_at         timestamptz not null default now()
);

-- Single source of truth for "is this user Premium right now?"
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
      and e.status in ('active', 'trialing')
      and (e.current_period_end is null or e.current_period_end > now())
  );
$$;

-- --------------------------------------------------------------------------
-- tasks / appointments / reminders / shopping / household
-- --------------------------------------------------------------------------
create table if not exists public.tasks (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           uuid not null,
  title        text not null check (char_length(title) between 1 and 120),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date     date not null,
  due_time     time,
  completed    boolean not null default false,
  completed_on date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default clock_timestamp(),
  deleted_at   timestamptz,
  primary key (user_id, id)
);

create table if not exists public.appointments (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid not null,
  title      text not null check (char_length(title) between 1 and 120),
  appt_date  date not null,
  appt_time  time,
  note       text not null default '' check (char_length(note) <= 200),
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.reminders (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          uuid not null,
  title       text not null check (char_length(title) between 1 and 120),
  category    text not null default 'general' check (category in ('general', 'bill')),
  remind_date date not null,
  remind_time time,
  note        text not null default '' check (char_length(note) <= 200),
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default clock_timestamp(),
  deleted_at  timestamptz,
  primary key (user_id, id)
);

create table if not exists public.shopping_items (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid not null,
  list_name  text not null default 'Shopping' check (char_length(list_name) <= 60),
  name       text not null check (char_length(name) between 1 and 80),
  checked    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- Household information (table is ready; the app screen for it comes later)
create table if not exists public.household_info (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid not null,
  label      text not null check (char_length(label) between 1 and 80),
  value      text not null default '' check (char_length(value) <= 500),
  category   text not null default 'general' check (char_length(category) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- --------------------------------------------------------------------------
-- preferences
-- --------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id                   uuid primary key references auth.users (id) on delete cascade,
  onboarded                 boolean not null default false,
  premium_interest          boolean not null default false,
  -- Memory: automatic collection is PAUSED by default. No AI engine exists yet.
  memory_collection_paused  boolean not null default true,
  updated_at                timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  push_enabled            boolean not null default false,   -- master switch for phone notifications
  tasks_enabled           boolean not null default true,
  appointments_enabled    boolean not null default true,
  reminders_enabled       boolean not null default true,
  bills_enabled           boolean not null default true,
  -- Minutes before the due time to notify. 0 = at the time.
  -- Free accounts are limited to ONE value (enforced by trigger below).
  lead_minutes            integer[] not null default '{0}'
                          check (cardinality(lead_minutes) between 1 and 4),
  -- Used for items that have a date but no time.
  default_time            time not null default '09:00',
  -- Premium: personalised morning briefing (enforced again at send time).
  morning_summary_enabled boolean not null default false,
  morning_summary_time    time not null default '08:00',
  updated_at              timestamptz not null default now()
);

create or replace function public.dm_limit_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_premium(new.user_id) then
    new.lead_minutes := new.lead_minutes[1:1];          -- free: one lead time only
    new.morning_summary_enabled := false;               -- free: no morning briefing
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- DAYMATE MEMORY
-- --------------------------------------------------------------------------
create table if not exists public.memories (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid not null,
  category   text not null check (category in (
               'personal_preferences', 'daily_routines', 'household', 'important_dates',
               'goals', 'shopping_preferences', 'meal_preferences', 'ongoing_projects',
               'conversation_info')),
  title      text not null default '' check (char_length(title) <= 80),
  content    text not null check (char_length(content) between 1 and 1000),
  -- 'manual' = typed by the user. 'ai' is reserved for the future AI engine, and
  -- an AI-sourced memory can only exist after the user approves a candidate.
  source     text not null default 'manual' check (source in ('manual', 'ai')),
  sensitive  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  fts        tsvector generated always as (
               to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) stored,
  primary key (user_id, id)
);
create index if not exists memories_fts_idx on public.memories using gin (fts);
create index if not exists memories_user_cat_idx on public.memories (user_id, category) where deleted_at is null;

-- Future AI extraction proposes candidates here; nothing becomes a memory until
-- the user approves it. (Nothing writes to this table yet.)
create table if not exists public.memory_candidates (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         uuid not null default gen_random_uuid(),
  category   text not null,
  content    text not null check (char_length(content) between 1 and 1000),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- --------------------------------------------------------------------------
-- Notification centre + web push
-- --------------------------------------------------------------------------
create table if not exists public.notifications (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           uuid not null default gen_random_uuid(),
  type         text not null check (type in ('task', 'appointment', 'reminder', 'bill', 'missed', 'summary', 'system')),
  title        text not null check (char_length(title) between 1 and 160),
  body         text not null default '' check (char_length(body) <= 300),
  source_type  text,
  source_id    uuid,
  -- Unique per user: stops the same alert being created twice (server push + in-app).
  dedupe_key   text not null check (char_length(dedupe_key) <= 200),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  dismissed_at timestamptz,        -- hidden from the inbox but kept in history
  primary key (user_id, id),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,            -- the endpoint identifies one browser/device
  p256dh       text not null,
  auth         text not null,
  user_agent   text not null default '',
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- --------------------------------------------------------------------------
-- Triggers
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tasks', 'appointments', 'reminders', 'shopping_items', 'household_info', 'memories']
  loop
    execute format('drop trigger if exists dm_touch on public.%I', t);
    execute format('create trigger dm_touch before insert or update on public.%I
                    for each row execute function public.dm_touch()', t);
  end loop;
end $$;

drop trigger if exists dm_limit_notification_prefs on public.notification_preferences;
create trigger dm_limit_notification_prefs
  before insert or update on public.notification_preferences
  for each row execute function public.dm_limit_notification_prefs();

-- A new sign-up gets a profile, a Free entitlement and default preferences.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 30))
  on conflict do nothing;
  insert into public.entitlements (user_id) values (new.id) on conflict do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

-- Backfill anyone who signed up before this script ran.
insert into public.profiles (id) select id from auth.users on conflict do nothing;
insert into public.entitlements (user_id) select id from auth.users on conflict do nothing;
insert into public.user_preferences (user_id) select id from auth.users on conflict do nothing;
insert into public.notification_preferences (user_id) select id from auth.users on conflict do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.entitlements             enable row level security;
alter table public.tasks                    enable row level security;
alter table public.appointments             enable row level security;
alter table public.reminders                enable row level security;
alter table public.shopping_items           enable row level security;
alter table public.household_info           enable row level security;
alter table public.user_preferences         enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.memories                 enable row level security;
alter table public.memory_candidates        enable row level security;
alter table public.notifications            enable row level security;
alter table public.push_subscriptions       enable row level security;

-- profiles (created by trigger; users read + update their own, never insert/delete)
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- entitlements: READ ONLY for users. No insert/update/delete policy exists.
drop policy if exists entitlements_select on public.entitlements;
create policy entitlements_select on public.entitlements for select to authenticated using (user_id = auth.uid());

-- user_preferences + notification_preferences: read + update own row
drop policy if exists user_preferences_select on public.user_preferences;
drop policy if exists user_preferences_update on public.user_preferences;
create policy user_preferences_select on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy user_preferences_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notification_preferences_select on public.notification_preferences;
drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Data tables: full CRUD on own rows only
do $$
declare t text;
begin
  foreach t in array array['tasks', 'appointments', 'reminders', 'shopping_items', 'household_info', 'memories']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

-- memory_candidates: users can read, approve/reject and delete theirs. Only the
-- server (service role) can create them.
drop policy if exists memory_candidates_select on public.memory_candidates;
drop policy if exists memory_candidates_update on public.memory_candidates;
drop policy if exists memory_candidates_delete on public.memory_candidates;
create policy memory_candidates_select on public.memory_candidates for select to authenticated using (user_id = auth.uid());
create policy memory_candidates_update on public.memory_candidates for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy memory_candidates_delete on public.memory_candidates for delete to authenticated using (user_id = auth.uid());

-- notifications: read, insert (in-app alerts), update read/dismissed, delete own
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_delete on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated with check (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- push_subscriptions: users can see and delete their own. Creating one goes
-- through register_push_subscription() below so an endpoint can't be shared.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- Privileges (defence in depth on top of RLS)
-- --------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Entitlements can never be written by the browser.
revoke insert, update, delete on public.entitlements from authenticated;
-- Profiles/preferences: no client inserts/deletes (trigger creates them).
revoke insert, delete on public.profiles, public.user_preferences, public.notification_preferences from authenticated;
-- Notifications: clients may only change read/dismissed state.
revoke update on public.notifications from authenticated;
grant update (read_at, dismissed_at) on public.notifications to authenticated;
-- Push subscriptions: no direct inserts/updates from the browser.
revoke insert, update on public.push_subscriptions from authenticated;
-- Memory candidates: only status may be changed by the user.
revoke update on public.memory_candidates from authenticated;
grant update (status) on public.memory_candidates to authenticated;
-- Note: synced_at is stamped by the dm_touch trigger on every insert/update, so
-- any value a client sends for it is overwritten by the server clock.

-- --------------------------------------------------------------------------
-- RPC: register this browser for push (called after the user opts in)
-- Moves the endpoint to the current user if another account used it before.
-- --------------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_endpoint is null or char_length(p_endpoint) not between 20 and 1000
     or p_endpoint !~ '^https://' then
    raise exception 'invalid endpoint';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- --------------------------------------------------------------------------
-- Server-side scheduling queries (service role only — used by the Edge Function)
-- --------------------------------------------------------------------------

-- Items whose notification time has arrived in the last `p_catchup` window.
-- Anything older than the window is NOT pushed (it appears as "missed" in-app).
create or replace function public.due_notification_candidates(
  p_now timestamptz default now(),
  p_catchup interval default interval '2 hours'
)
returns table (
  user_id uuid, source_type text, source_id uuid, notif_type text,
  title text, body text, lead integer, due_local text, notify_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select t.user_id, 'task'::text as source_type, t.id as source_id, 'task'::text as notif_type,
           t.title, ''::text as note, t.due_date as d, t.due_time as tm
      from public.tasks t
     where not t.completed and t.deleted_at is null
    union all
    select a.user_id, 'appointment', a.id, 'appointment', a.title, a.note, a.appt_date, a.appt_time
      from public.appointments a
     where not a.done and a.deleted_at is null
    union all
    select r.user_id, 'reminder', r.id, case when r.category = 'bill' then 'bill' else 'reminder' end,
           r.title, r.note, r.remind_date, r.remind_time
      from public.reminders r
     where not r.done and r.deleted_at is null
  ), expanded as (
    select i.*, p.timezone, np.default_time, np.lead_minutes, np.tasks_enabled,
           np.appointments_enabled, np.reminders_enabled, np.bills_enabled,
           public.is_premium(i.user_id) as premium
      from items i
      join public.notification_preferences np on np.user_id = i.user_id and np.push_enabled
      join public.profiles p on p.id = i.user_id
  ), timed as (
    select e.*, l.lead,
           ((e.d + coalesce(e.tm, e.default_time)) at time zone e.timezone) as due_at
      from expanded e
      cross join lateral unnest(case when e.premium then e.lead_minutes else e.lead_minutes[1:1] end) as l(lead)
     where (e.notif_type = 'task'        and e.tasks_enabled)
        or (e.notif_type = 'appointment' and e.appointments_enabled)
        or (e.notif_type = 'reminder'    and e.reminders_enabled)
        or (e.notif_type = 'bill'        and e.bills_enabled)
  )
  select t.user_id, t.source_type, t.source_id, t.notif_type, t.title,
         case
           when t.lead = 0 then 'Due now' || case when t.note <> '' then ' · ' || t.note else '' end
           when t.lead < 60 then 'Due in ' || t.lead || ' min' || case when t.note <> '' then ' · ' || t.note else '' end
           else 'Due in ' || (t.lead / 60) || ' h' || case when t.note <> '' then ' · ' || t.note else '' end
         end as body,
         t.lead,
         to_char(t.due_at at time zone t.timezone, 'YYYY-MM-DD"T"HH24:MI') as due_local,
         (t.due_at - make_interval(mins => t.lead)) as notify_at
    from timed t
   where (t.due_at - make_interval(mins => t.lead)) <= p_now
     and (t.due_at - make_interval(mins => t.lead)) >  p_now - p_catchup;
$$;

-- Morning briefing: Premium only, once per local day, at/after the chosen time.
create or replace function public.morning_summary_candidates(p_now timestamptz default now())
returns table (user_id uuid, title text, body text, day_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select np.user_id,
         'Good morning' || case when p.display_name <> '' then ', ' || p.display_name else '' end,
         (case when c.tasks + c.appts + c.reminders + c.bills = 0
               then 'Nothing scheduled for today. Enjoy a clear day.'
               else concat_ws(', ',
                      nullif(c.tasks || ' task' || case when c.tasks = 1 then '' else 's' end, '0 tasks'),
                      case when c.appts > 0 then c.appts || ' appointment' || case when c.appts = 1 then '' else 's' end end,
                      case when c.reminders > 0 then c.reminders || ' reminder' || case when c.reminders = 1 then '' else 's' end end,
                      case when c.bills > 0 then c.bills || ' bill' || case when c.bills = 1 then '' else 's' end end
                    ) || ' today'
          end),
         'summary:' || to_char(p_now at time zone p.timezone, 'YYYY-MM-DD')
    from public.notification_preferences np
    join public.profiles p on p.id = np.user_id
    cross join lateral (
      select
        (select count(*) from public.tasks t where t.user_id = np.user_id and not t.completed
            and t.deleted_at is null and t.due_date <= (p_now at time zone p.timezone)::date)::int as tasks,
        (select count(*) from public.appointments a where a.user_id = np.user_id and not a.done
            and a.deleted_at is null and a.appt_date = (p_now at time zone p.timezone)::date)::int as appts,
        (select count(*) from public.reminders r where r.user_id = np.user_id and not r.done
            and r.deleted_at is null and r.category = 'general'
            and r.remind_date = (p_now at time zone p.timezone)::date)::int as reminders,
        (select count(*) from public.reminders r where r.user_id = np.user_id and not r.done
            and r.deleted_at is null and r.category = 'bill'
            and r.remind_date = (p_now at time zone p.timezone)::date)::int as bills
    ) c
   where np.push_enabled
     and np.morning_summary_enabled
     and public.is_premium(np.user_id)
     and (p_now at time zone p.timezone)::time >= np.morning_summary_time
     and (p_now at time zone p.timezone)::time <  np.morning_summary_time + interval '2 hours';
$$;

-- Only the service role may run the scheduling queries.
revoke all on function public.due_notification_candidates(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.morning_summary_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.due_notification_candidates(timestamptz, interval) to service_role;
grant execute on function public.morning_summary_candidates(timestamptz) to service_role;
revoke all on function public.is_premium(uuid) from public, anon;
grant execute on function public.is_premium(uuid) to authenticated, service_role;
