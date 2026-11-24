-- DAYMATE — Stage C planner (idempotent, additive).
-- Adds: Urgent priority, categories, repeat rules, important dates,
-- and a nightly job that rolls repeating appointments forward.

-- tasks: allow 'urgent'
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.tasks'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%priority%'
  loop execute format('alter table public.tasks drop constraint %I', c); end loop;
end $$;
alter table public.tasks add constraint tasks_priority_check check (priority in ('low', 'medium', 'high', 'urgent'));

alter table public.tasks        add column if not exists category    text not null default 'personal';
alter table public.tasks        add column if not exists repeat_rule text not null default '';
alter table public.appointments add column if not exists category    text not null default 'personal';
alter table public.appointments add column if not exists repeat_rule text not null default '';
alter table public.appointments add column if not exists important   boolean not null default false;
-- reminders already has `category` (general | bill), so the planner category is `category_tag`.
alter table public.reminders    add column if not exists category_tag text not null default 'personal';
alter table public.reminders    add column if not exists repeat_rule  text not null default '';
alter table public.reminders    add column if not exists important    boolean not null default false;

do $$
declare t text; col text;
begin
  foreach t in array array['tasks', 'appointments', 'reminders'] loop
    col := case when t = 'reminders' then 'category_tag' else 'category' end;
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_planner_cat_check');
    execute format('alter table public.%I add constraint %I check (%I in (''personal'',''family'',''work'',''shopping'',''bills''))', t, t || '_planner_cat_check', col);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_repeat_check');
    execute format('alter table public.%I add constraint %I check (repeat_rule in ('''',''daily'',''weekly'',''monthly'',''yearly''))', t, t || '_repeat_check');
  end loop;
end $$;

-- Roll repeating appointments / important dates forward once their day has passed
-- (so server push alerts keep working even if the app isn't opened).
create or replace function public.dm_advance_recurring()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record; today date; nxt date; n integer := 0; i integer;
begin
  for r in
    select a.user_id, a.id, a.appt_date as d, a.repeat_rule as rule,
           coalesce(p.timezone, 'Europe/London') as tz
      from public.appointments a
      join public.profiles p on p.id = a.user_id
     where a.repeat_rule <> '' and a.deleted_at is null
  loop
    today := (now() at time zone r.tz)::date;
    if r.d >= today then continue; end if;
    nxt := r.d;
    if r.rule = 'daily' then nxt := today;
    elsif r.rule = 'weekly' then nxt := r.d + (((today - r.d) + 6) / 7) * 7;
    else
      i := 0;
      while nxt < today and i < 2000 loop
        nxt := (nxt + case when r.rule = 'monthly' then interval '1 month' else interval '1 year' end)::date;
        i := i + 1;
      end loop;
    end if;
    update public.appointments
       set appt_date = nxt, done = false, updated_at = now()
     where user_id = r.user_id and id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.dm_advance_recurring() from public, anon, authenticated;
grant execute on function public.dm_advance_recurring() to service_role;

-- Run once a night (after the first deployment: select cron.schedule(...) is below).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'daymate-advance-recurring';
    perform cron.schedule('daymate-advance-recurring', '10 0 * * *', 'select public.dm_advance_recurring();');
  end if;
end $$;
