-- ==========================================================================
-- DAYMATE — database tests (RLS, entitlements, sync rules, scheduling)
-- Runs against a scratch Postgres with Supabase-style roles (anon,
-- authenticated, service_role) and an auth.users table. NOT for production.
-- Usage:  psql -v ON_ERROR_STOP=1 -f rls_and_scheduling_test.sql
-- ==========================================================================
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set B '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''

drop table if exists test_results;
create table test_results (name text, ok boolean, detail text);
grant all on test_results to public;

create or replace function t_ok(n text, c boolean, d text default '') returns void
language sql as $$ insert into test_results values (n, coalesce(c, false), d) $$;

-- expect_err: runs q and passes only if it raises an error (or affects 0 rows when zero_ok)
create or replace function t_err(n text, q text) returns void language plpgsql as $$
begin
  execute q;
  insert into test_results values (n, false, 'expected an error but succeeded');
exception when others then
  insert into test_results values (n, true, sqlerrm);
end $$;

create or replace function t_rows(n text, q text, expected int) returns void language plpgsql as $$
declare c int;
begin
  execute 'select count(*) from (' || q || ') s' into c;
  insert into test_results values (n, c = expected, 'got ' || c || ', expected ' || expected);
exception when others then
  insert into test_results values (n, false, sqlerrm);
end $$;

grant execute on function t_ok(text, boolean, text), t_err(text, text), t_rows(text, text, int) to public;

-- Fresh users (trigger should create profile, entitlement, prefs)
truncate auth.users cascade;
insert into auth.users (id, email) values (:A, 'a@example.com'), (:B, 'b@example.com');

insert into auth.users (id, email, raw_user_meta_data) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@example.com', '{"display_name":"Luke"}');
select t_ok('signup copies display name from metadata', (select display_name from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 'Luke');
delete from auth.users where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select t_ok('signup creates profile', (select count(*) from public.profiles) = 2);
select t_ok('signup creates FREE entitlement', (select count(*) from public.entitlements where plan = 'free') = 2);
select t_ok('signup creates preferences', (select count(*) from public.user_preferences) = 2
        and (select count(*) from public.notification_preferences) = 2);
select t_ok('memory collection paused by default', (select bool_and(memory_collection_paused) from public.user_preferences));
select t_ok('push off by default', (select not bool_or(push_enabled) from public.notification_preferences));

-- ---------------------------------------------------------------- user A
set role authenticated;
select set_config('request.jwt.claim.sub', :A, false);

insert into public.tasks (id, title, due_date, due_time)
  values ('11111111-1111-4111-8111-111111111111', 'A task', '2026-11-23', '09:30');
insert into public.appointments (id, title, appt_date, appt_time)
  values ('22222222-2222-4222-8222-222222222222', 'A appt', '2026-11-23', '14:30');
insert into public.reminders (id, title, category, remind_date)
  values ('33333333-3333-4333-8333-333333333333', 'A bill', 'bill', '2026-11-23');
insert into public.shopping_items (id, name) values ('44444444-4444-4444-8444-444444444444', 'Milk');
insert into public.memories (id, category, title, content)
  values ('55555555-5555-4555-8555-555555555555', 'meal_preferences', 'Spice', 'Loves a vindaloo on Fridays');
select t_ok('A can read own task', (select count(*) from public.tasks) = 1);
select t_ok('task user_id defaults to auth.uid()', (select user_id::text from public.tasks) = :A);

-- ---------------------------------------------------------------- user B
select set_config('request.jwt.claim.sub', :B, false);
select t_rows('B cannot see A tasks',         'select 1 from public.tasks', 0);
select t_rows('B cannot see A appointments',  'select 1 from public.appointments', 0);
select t_rows('B cannot see A reminders',     'select 1 from public.reminders', 0);
select t_rows('B cannot see A shopping',      'select 1 from public.shopping_items', 0);
select t_rows('B cannot see A memories',      'select 1 from public.memories', 0);
select t_rows('B cannot see A profile',       format('select 1 from public.profiles where id = %L', :A), 0);
select t_rows('B cannot see A entitlement',   format('select 1 from public.entitlements where user_id = %L', :A), 0);
select t_rows('B cannot see A prefs',         format('select 1 from public.notification_preferences where user_id = %L', :A), 0);

-- B attacks
with u as (update public.tasks set title = 'hacked' where id = '11111111-1111-4111-8111-111111111111' returning 1)
select t_ok('B cannot update A task (0 rows)', (select count(*) from u) = 0);
with d as (delete from public.tasks where id = '11111111-1111-4111-8111-111111111111' returning 1)
select t_ok('B cannot delete A task (0 rows)', (select count(*) from d) = 0);
select t_err('B cannot insert a row owned by A',
  format('insert into public.tasks (user_id, id, title, due_date) values (%L, gen_random_uuid(), ''x'', ''2026-11-23'')', :A));
select t_err('B cannot hijack A row via upsert',
  format('insert into public.memories (user_id, id, category, content) values (%L, ''55555555-5555-4555-8555-555555555555'', ''goals'', ''x'') on conflict (user_id, id) do update set content = excluded.content', :A));

-- Same local UUID can be migrated into two accounts (composite key)
insert into public.tasks (id, title, due_date) values ('11111111-1111-4111-8111-111111111111', 'B copy of same id', '2026-11-23');
select t_ok('same id allowed in a second account', (select count(*) from public.tasks) = 1);
select set_config('request.jwt.claim.sub', :A, false);
select t_ok('A task untouched by B copy', (select title from public.tasks) = 'A task');

-- ---------------------------------------------------------------- entitlements
select t_err('user cannot grant self Premium (update)',
  format('update public.entitlements set plan = ''premium'' where user_id = %L', :A));
select t_err('user cannot insert entitlement',
  format('insert into public.entitlements (user_id, plan) values (%L, ''premium'') on conflict (user_id) do update set plan = ''premium''', :A));
select t_err('user cannot delete entitlement', format('delete from public.entitlements where user_id = %L', :A));
select t_ok('is_premium false for free user', not public.is_premium((select :A::uuid)));

-- ---------------------------------------------------------------- profiles
update public.profiles set display_name = 'Luke', timezone = 'Europe/London' where id = :A;
select t_ok('user can update own profile', (select display_name from public.profiles) = 'Luke');
select t_err('user cannot insert a profile', 'insert into public.profiles (id) values (gen_random_uuid())');
select t_err('profile name length enforced', 'update public.profiles set display_name = repeat(''x'', 31)');

-- ---------------------------------------------------------------- sync rules
-- stale write ignored
update public.tasks set title = 'newer', updated_at = '2030-01-01T00:00:00Z' where id = '11111111-1111-4111-8111-111111111111';
update public.tasks set title = 'older', updated_at = '2020-01-01T00:00:00Z' where id = '11111111-1111-4111-8111-111111111111';
select t_ok('stale (older) write is ignored', (select title from public.tasks) = 'newer');
-- soft delete syncs as an update
update public.tasks set deleted_at = now(), updated_at = '2031-01-01T00:00:00Z' where id = '11111111-1111-4111-8111-111111111111';
select t_ok('soft delete stored', (select deleted_at is not null from public.tasks));
-- synced_at not client writable
update public.tasks set synced_at = now() - interval '1 year' where id = '11111111-1111-4111-8111-111111111111';
select t_ok('client-supplied synced_at is overwritten by server clock',
  (select synced_at > now() - interval '1 minute' from public.tasks));
-- constraints
select t_err('empty title rejected', 'insert into public.tasks (id, title, due_date) values (gen_random_uuid(), '''', ''2026-11-23'')');
select t_err('bad priority rejected', 'insert into public.tasks (id, title, due_date, priority) values (gen_random_uuid(), ''x'', ''2026-11-23'', ''urgent'')');
select t_err('bad memory category rejected', 'insert into public.memories (id, category, content) values (gen_random_uuid(), ''secrets'', ''x'')');
select t_err('memory source ai not blocked but category still enforced', 'insert into public.memories (id, category, content, source) values (gen_random_uuid(), ''nope'', ''x'', ''ai'')');
-- full text search
select t_rows('memory full-text search finds match', 'select 1 from public.memories where fts @@ websearch_to_tsquery(''english'', ''vindaloo'')', 1);
select t_rows('memory full-text search no false match', 'select 1 from public.memories where fts @@ websearch_to_tsquery(''english'', ''lasagne'')', 0);
-- revert the soft delete for scheduling tests (newer updated_at)
update public.tasks set deleted_at = null, completed = false, updated_at = '2032-01-01T00:00:00Z' where id = '11111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------- notification prefs (free limits)
update public.notification_preferences set push_enabled = true, lead_minutes = '{0,15,60}', morning_summary_enabled = true;
select t_ok('free: lead_minutes trimmed to one value', (select lead_minutes from public.notification_preferences) = '{0}');
select t_ok('free: morning summary forced off', (select not morning_summary_enabled from public.notification_preferences));

-- ---------------------------------------------------------------- notifications table
insert into public.notifications (id, type, title, dedupe_key) values ('66666666-6666-4666-8666-666666666666', 'task', 'Hello', 'k1');
select t_err('duplicate dedupe_key blocked', 'insert into public.notifications (type, title, dedupe_key) values (''task'', ''Hello again'', ''k1'')');
select t_err('cannot edit notification title', 'update public.notifications set title = ''edited''');
update public.notifications set read_at = now();
select t_ok('can mark notification read', (select read_at is not null from public.notifications));
update public.notifications set dismissed_at = now();
select t_ok('can dismiss notification', (select dismissed_at is not null from public.notifications));
select set_config('request.jwt.claim.sub', :B, false);
select t_rows('B cannot see A notifications', 'select 1 from public.notifications', 0);
select set_config('request.jwt.claim.sub', :A, false);

-- ---------------------------------------------------------------- push subscriptions
select public.register_push_subscription('https://push.example.com/endpoint-abcdefghijk', 'p256', 'authsecret', 'UA');
select t_ok('A registered push sub', (select count(*) from public.push_subscriptions) = 1);
select t_err('direct insert into push_subscriptions blocked',
  format('insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (%L, ''https://x.example.com/abcdefghijklmnopq'', ''a'', ''b'')', :A));
select t_err('non-https endpoint rejected', 'select public.register_push_subscription(''http://insecure.example.com/abcdefghijk'', ''a'', ''b'')');
select set_config('request.jwt.claim.sub', :B, false);
select t_rows('B cannot see A push subs', 'select 1 from public.push_subscriptions', 0);
select public.register_push_subscription('https://push.example.com/endpoint-abcdefghijk', 'p256-b', 'authsecret-b', 'UA2');
select t_ok('same device endpoint moves to B', (select count(*) from public.push_subscriptions) = 1);
select set_config('request.jwt.claim.sub', :A, false);
select t_rows('A no longer holds the moved endpoint', 'select 1 from public.push_subscriptions', 0);

-- ---------------------------------------------------------------- anon + authenticated cannot run server queries
reset role;
set role anon;
select t_err('anon cannot read tasks', 'select * from public.tasks');
select t_err('anon cannot read entitlements', 'select * from public.entitlements');
select t_err('anon cannot register push', 'select public.register_push_subscription(''https://push.example.com/zzzzzzzzzzzzzzzzzzzz'', ''a'', ''b'')');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :A, false);
select t_err('authenticated cannot call due_notification_candidates', 'select * from public.due_notification_candidates()');
select t_err('authenticated cannot call morning_summary_candidates', 'select * from public.morning_summary_candidates()');
reset role;

-- ================================================================ scheduling (as service role / server)
set role service_role;

-- A: London (GMT in November). Task 09:30 today-ish, lead 0.
select t_rows('due at the moment (09:30 London, now 09:30:30Z)',
  format('select 1 from public.due_notification_candidates(''2026-11-23T09:30:30Z'') where source_type = ''task'' and user_id = %L', :A), 1);
select t_rows('not due before the time (09:20)',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:20:00Z'') where source_type = ''task''', 0);
select t_rows('catch-up window respected: 3h late is NOT pushed',
  'select 1 from public.due_notification_candidates(''2026-11-23T12:45:00Z'') where source_type = ''task''', 0);
select t_rows('appointment due 14:30',
  'select 1 from public.due_notification_candidates(''2026-11-23T14:30:10Z'') where source_type = ''appointment''', 1);
select t_rows('date-only bill uses default_time 09:00',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:00:10Z'') where notif_type = ''bill''', 1);
select t_ok('bill candidate typed as bill',
  (select notif_type from public.due_notification_candidates('2026-11-23T09:00:10Z') where source_type = 'reminder') = 'bill');
select t_ok('dedupe-relevant due_local present',
  (select due_local from public.due_notification_candidates('2026-11-23T09:30:30Z') where source_type = 'task') = '2026-11-23T09:30');

-- timezone: switch A to New York -> 09:30 local is 14:30Z
reset role;
update public.profiles set timezone = 'America/New_York' where id = :A::uuid;
set role service_role;
select t_rows('timezone respected: not due at 09:30Z for New York',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:30:30Z'') where source_type = ''task''', 0);
select t_rows('timezone respected: due at 14:30Z for New York',
  'select 1 from public.due_notification_candidates(''2026-11-23T14:30:30Z'') where source_type = ''task''', 1);
reset role;
update public.profiles set timezone = 'Europe/London' where id = :A::uuid;

-- category switch off
update public.notification_preferences set tasks_enabled = false where user_id = :A::uuid;
set role service_role;
select t_rows('tasks_enabled=false suppresses task pushes',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:30:30Z'') where source_type = ''task''', 0);
reset role;
update public.notification_preferences set tasks_enabled = true where user_id = :A::uuid;

-- master switch off
update public.notification_preferences set push_enabled = false where user_id = :A::uuid;
set role service_role;
select t_rows('push_enabled=false suppresses everything',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:30:30Z'')', 0);
reset role;
update public.notification_preferences set push_enabled = true where user_id = :A::uuid;

-- completed + soft deleted excluded
update public.tasks set completed = true, updated_at = '2033-01-01Z' where user_id = :A::uuid;
set role service_role;
select t_rows('completed task not pushed',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:30:30Z'') where source_type = ''task''', 0);
reset role;
update public.tasks set completed = false, deleted_at = now(), updated_at = '2034-01-01Z' where user_id = :A::uuid;
set role service_role;
select t_rows('deleted task not pushed',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:30:30Z'') where source_type = ''task''', 0);
reset role;
update public.tasks set deleted_at = null, updated_at = '2035-01-01Z' where user_id = :A::uuid;

-- morning summary: free user gets none
set role service_role;
select t_rows('free user: no morning summary',
  'select 1 from public.morning_summary_candidates(''2026-11-23T08:10:00Z'')', 0);
reset role;

-- Upgrade A to premium (server-side, as the Stripe webhook eventually would)
update public.entitlements set plan = 'premium', source = 'manual' where user_id = :A::uuid;
select t_ok('is_premium true after server upgrade', public.is_premium(:A::uuid));
update public.notification_preferences set lead_minutes = '{0,15,60}', morning_summary_enabled = true where user_id = :A::uuid;
select t_ok('premium: multiple lead times kept', (select lead_minutes from public.notification_preferences where user_id = :A::uuid) = '{0,15,60}');
select t_ok('premium: morning summary kept on', (select morning_summary_enabled from public.notification_preferences where user_id = :A::uuid));

set role service_role;
select t_rows('premium 15-min lead fires at 09:15',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:15:10Z'') where source_type = ''task'' and lead = 15', 1);
select t_rows('premium 60-min lead fires at 08:30',
  'select 1 from public.due_notification_candidates(''2026-11-23T08:30:10Z'') where source_type = ''task'' and lead = 60', 1);
select t_rows('morning summary at 08:10 London for premium',
  'select 1 from public.morning_summary_candidates(''2026-11-23T08:10:00Z'')', 1);
select t_rows('morning summary not before 08:00',
  'select 1 from public.morning_summary_candidates(''2026-11-23T07:30:00Z'')', 0);
select t_rows('morning summary not after 2h window',
  'select 1 from public.morning_summary_candidates(''2026-11-23T11:00:00Z'')', 0);
select t_ok('morning summary text counts today',
  (select body from public.morning_summary_candidates('2026-11-23T08:10:00Z')) like '1 task, 1 appointment, 1 bill today',
  (select body from public.morning_summary_candidates('2026-11-23T08:10:00Z')));
select t_ok('morning summary dedupe key is per local day',
  (select day_key from public.morning_summary_candidates('2026-11-23T08:10:00Z')) = 'summary:2026-11-23');
reset role;

-- entitlement expiry downgrades server behaviour immediately
update public.entitlements set current_period_end = now() - interval '1 day' where user_id = :A::uuid;
select t_ok('expired premium is not premium', not public.is_premium(:A::uuid));
set role service_role;
select t_rows('expired premium: no morning summary',
  'select 1 from public.morning_summary_candidates(''2026-11-23T08:10:00Z'')', 0);
select t_rows('expired premium: extra lead times not used',
  'select 1 from public.due_notification_candidates(''2026-11-23T09:15:10Z'') where lead = 15', 0);
reset role;

-- ---------------------------------------------------------------- cascade delete (account removal)
delete from auth.users where id = :B::uuid;
select t_ok('deleting a user cascades their data',
  (select count(*) from public.tasks where user_id = :B::uuid) = 0
  and (select count(*) from public.profiles where id = :B::uuid) = 0);

-- ---------------------------------------------------------------- report
select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail
from test_results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(*) as total from test_results;
