-- LineSmart visits-by-state count: a first-party, aggregate-only tally of visits per US state per day.
-- Run once in the Supabase dashboard SQL editor (project ctklbryattbbsqdmteny) when Rod approves. Safe to re-run.
--
-- Why: Cloudflare Web Analytics reports visitors by country only (no region/state dimension), and sportsbook affiliate
-- applications ask for traffic by state. The site (assets/geo.js) already knows the visitor's state code for the
-- state-aware offers; once a day per browser, on linesmart.app only, it calls state_visit_bump('FL').
--
-- Privacy (privacy.html#state-counts):
--  * The table holds ONLY (day, state, visits). No IP address, user id, user agent, cookie or timestamp per visit.
--    The function never reads request headers, so nothing about the caller is stored or logged by this code.
--  * RLS is on with NO policies, and anon/authenticated have no table grants: the publishable key can't read, insert,
--    update or delete rows. The ONLY thing a visitor can do is add 1 to today's count for a valid state code through
--    state_visit_bump(), a SECURITY DEFINER function with a fixed search_path.
--  * Only the service role (dashboard / SQL editor) can read the counts. See the report query at the bottom.
--
-- Abuse: anyone can call the function, so a script could inflate a state's count. A per-(day, state) cap
-- (state_visit_settings.daily_cap) bounds the damage; counts are directional, not audited numbers.

-- ---------------------------------------------------------------- tables
create table if not exists public.state_visits (
  day     date not null,                                   -- US Eastern calendar day
  state   text not null check (state ~ '^[A-Z]{2}$'),
  visits  integer not null default 0 check (visits >= 0),
  primary key (day, state)
);

create table if not exists public.state_visit_settings (
  id         int primary key default 1 check (id = 1),
  enabled    boolean not null default true,
  daily_cap  int not null default 20000 check (daily_cap > 0)   -- max counted visits per state per day
);
insert into public.state_visit_settings (id) values (1) on conflict (id) do nothing;

alter table public.state_visits enable row level security;
alter table public.state_visit_settings enable row level security;
revoke all on table public.state_visits from public, anon, authenticated;
revoke all on table public.state_visit_settings from public, anon, authenticated;

-- ---------------------------------------------------------------- the only entry point
-- state_visit_bump('FL'): +1 for (today in US Eastern, 'FL'). Unknown codes are ignored (returns false).
create or replace function public.state_visit_bump(p_state text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  st  text := upper(btrim(coalesce(p_state, '')));
  cfg public.state_visit_settings;
  d   date := (now() at time zone 'America/New_York')::date;
begin
  if st not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
                'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD',
                'TN','TX','UT','VT','VA','WA','WV','WI','WY','PR') then
    return false;
  end if;
  select * into cfg from public.state_visit_settings where id = 1;
  if cfg.id is not null and not cfg.enabled then return false; end if;

  insert into public.state_visits as v (day, state, visits) values (d, st, 1)
  on conflict (day, state) do update
    set visits = v.visits + 1
    where v.visits < coalesce(cfg.daily_cap, 20000);
  return true;
end;
$$;

revoke all on function public.state_visit_bump(text) from public;
grant execute on function public.state_visit_bump(text) to anon, authenticated;

-- ---------------------------------------------------------------- report (run as service role in the SQL editor)
-- Last 30 days by state:
--   select state, sum(visits) as visits from public.state_visits
--   where day >= (now() at time zone 'America/New_York')::date - 30 group by state order by visits desc;
-- To pause counting without a deploy: update public.state_visit_settings set enabled = false where id = 1;
