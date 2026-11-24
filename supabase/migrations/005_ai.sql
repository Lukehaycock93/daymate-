-- DAYMATE — Stage D: AI assistant (idempotent).
--   * ai_consent_at   : the person agreed to send messages/schedule to the AI provider
--   * ai_conversations / ai_messages : chat history (written only by the Edge Function)
--   * ai_usage + dm_ai_bump() : per-day message allowance (Free vs Premium decided on the server)

alter table public.user_preferences add column if not exists ai_consent_at timestamptz;

create table if not exists public.ai_conversations (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         uuid not null default gen_random_uuid(),
  title      text not null default '' check (char_length(title) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.ai_messages (
  user_id         uuid not null references auth.users (id) on delete cascade,
  id              uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) <= 4000),
  proposals       jsonb,
  created_at      timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, conversation_id) references public.ai_conversations (user_id, id) on delete cascade
);
create index if not exists ai_messages_conv_idx on public.ai_messages (user_id, conversation_id, created_at);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_usage         enable row level security;

drop policy if exists ai_conversations_select on public.ai_conversations;
drop policy if exists ai_conversations_delete on public.ai_conversations;
drop policy if exists ai_messages_select on public.ai_messages;
drop policy if exists ai_messages_delete on public.ai_messages;
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_conversations_select on public.ai_conversations for select to authenticated using (user_id = auth.uid());
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated using (user_id = auth.uid());
create policy ai_messages_select      on public.ai_messages      for select to authenticated using (user_id = auth.uid());
create policy ai_messages_delete      on public.ai_messages      for delete to authenticated using (user_id = auth.uid());
create policy ai_usage_select         on public.ai_usage         for select to authenticated using (user_id = auth.uid());

-- People can read and delete their chats; only the server can write them.
revoke all on public.ai_conversations, public.ai_messages, public.ai_usage from anon, authenticated;
grant select, delete on public.ai_conversations, public.ai_messages to authenticated;
grant select on public.ai_usage to authenticated;

-- Count one message against today's allowance; refuses once the limit is reached.
create or replace function public.dm_ai_bump(p_user uuid, p_day date, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare c integer;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, p_day, 0) on conflict do nothing;
  update public.ai_usage set count = count + 1
   where user_id = p_user and day = p_day and count < p_limit
   returning count into c;
  if c is null then
    return query select false, p_limit;
  else
    return query select true, c;
  end if;
end;
$$;
revoke all on function public.dm_ai_bump(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.dm_ai_bump(uuid, date, integer) to service_role;

-- Housekeeping: chats are kept for 90 days, usage counters for 7.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'daymate-purge-ai';
    perform cron.schedule('daymate-purge-ai', '23 3 * * *',
      $q$ delete from public.ai_conversations where updated_at < now() - interval '90 days';
          delete from public.ai_usage where day < current_date - 7; $q$);
  end if;
end $$;
