-- Daily count of new LineSmart accounts by the button that started sign-up.
-- Run once in the Supabase SQL editor (project ctklbryattbbsqdmteny). Safe to re-run.
-- Does not read or write pro_access. Does not create auth users. Does not send email.
--
-- The website cannot read this table. A signed-in person can only add their own row, and only
-- when the account was created in the last 24 hours. The function always returns 'ok' and no
-- email, id, or other personal data. A second call does nothing.

create table if not exists public.signup_entries (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  entry      text not null check (entry in ('bell', 'my-bets', 'newsletter', 'waitlist', 'account')),
  created_at timestamptz not null default now()
);
create index if not exists signup_entries_day_idx on public.signup_entries (created_at, entry);

alter table public.signup_entries enable row level security;
revoke all on table public.signup_entries from anon, authenticated;

create or replace function public.record_signup_entry(p_entry text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_entry   text := case
    when p_entry in ('bell', 'my-bets', 'newsletter', 'waitlist', 'account') then p_entry
    else 'account'
  end;
begin
  if v_uid is null then return 'ok'; end if;
  select created_at into v_created from auth.users where id = v_uid;
  -- Existing accounts are not backfilled. The row's day is the day the account was created.
  if v_created is null or v_created < now() - interval '24 hours' then return 'ok'; end if;
  insert into public.signup_entries (user_id, entry, created_at)
  values (v_uid, v_entry, v_created)
  on conflict (user_id) do nothing;
  return 'ok';
end $$;

revoke all on function public.record_signup_entry(text) from public;
grant execute on function public.record_signup_entry(text) to authenticated;

-- Owner query (SQL editor only). Counts only. No emails, no user ids.
-- The same query is in scripts/signup_counts.sql.
--   select (created_at at time zone 'America/New_York')::date as day, entry, count(*)::int as signups
--   from public.signup_entries
--   group by 1, 2
--   order by 1 desc, 3 desc;
