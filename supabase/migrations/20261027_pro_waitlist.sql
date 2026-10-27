-- LineSmart Pro waitlist: email + 21+ + a 3-question survey. No email is sent on signup.
-- Run once in the Supabase dashboard SQL editor (project ctklbryattbbsqdmteny) at go-live. Safe to re-run.
--
-- Design (same approach as 20261026_newsletter.sql)
--  * public.pro_waitlist has RLS on and NO policies, and anon/authenticated have no table grants, so the publishable
--    key can't select, update or delete rows, and can't insert directly either. The ONLY thing a visitor can do is add
--    (or update) their own entry through pro_waitlist_join(), a SECURITY DEFINER function that validates input,
--    rate-limits per hashed IP and dedupes by email. A plain "anon may insert" policy would let bots skip the rate
--    limit, leak whether an address is already on the list (unique-key errors) and let anyone claim any user_id.
--  * Only the service role (dashboard / SQL editor / server code) can read the list; it bypasses RLS.
--  * user_id is never taken from the client: it is auth.uid() from the caller's JWT when they're signed in.

-- ---------------------------------------------------------------- tables
create table if not exists public.pro_waitlist (
  id            bigint generated always as identity primary key,
  email         text not null unique check (char_length(email) between 6 and 254 and email = lower(email)),
  user_id       uuid references auth.users (id) on delete set null,
  features      text[] not null default '{}' check (features <@ array['props_ev','alerts_25','tracker_pro','books_10','line_history','fast_refresh']::text[]),
  sports        text[] not null default '{}' check (sports <@ array['nfl','nba','mlb','nhl','ncaaf','ncaab','ufc']::text[]),
  price_choice  text check (price_choice in ('4.99', '9.99', '14.99', 'more')),
  is_21         boolean not null check (is_21),
  state         text check (state ~ '^[A-Z]{2}$'),
  source        text check (char_length(source) <= 24),          -- pro / value / alerts / bets / footer
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pro_waitlist_created_idx on public.pro_waitlist (created_at);

-- Join attempts, for rate limiting only. IP addresses are stored as salted hashes, kept 2 days.
create table if not exists public.pro_waitlist_log (
  id       bigint generated always as identity primary key,
  ip_hash  text not null,
  at       timestamptz not null default now()
);
create index if not exists pro_waitlist_log_ip_idx on public.pro_waitlist_log (ip_hash, at);
create index if not exists pro_waitlist_log_at_idx on public.pro_waitlist_log (at);

create table if not exists public.pro_waitlist_settings (
  id             int primary key default 1 check (id = 1),
  ip_hourly_cap  int not null default 5,      -- join attempts per IP per hour
  daily_cap      int not null default 1000,   -- total join attempts per UTC day (spam brake)
  ip_salt        text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.pro_waitlist_settings (id) values (1) on conflict (id) do nothing;

alter table public.pro_waitlist          enable row level security;
alter table public.pro_waitlist_log      enable row level security;
alter table public.pro_waitlist_settings enable row level security;
-- No policies on purpose: nothing is readable or writable with the publishable key except via pro_waitlist_join().
revoke all on table public.pro_waitlist, public.pro_waitlist_log, public.pro_waitlist_settings from anon, authenticated;

-- ---------------------------------------------------------------- public API (publishable key)
-- Returns one of: ok | invalid_email | age_required | rate_limited | busy
-- Same answer ("ok") whether the address is new or already on the list, so it can't be used to test addresses.
create or replace function public.pro_waitlist_join(
  p_email text, p_is_21 boolean, p_features text[] default '{}', p_sports text[] default '{}',
  p_price text default null, p_state text default null, p_source text default 'pro', p_website text default '')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s       public.pro_waitlist_settings;
  r       public.pro_waitlist;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid   uuid := auth.uid();
  v_feat  text[];
  v_sport text[];
  v_price text := case when p_price in ('4.99', '9.99', '14.99', 'more') then p_price end;
  v_state text := case when upper(btrim(coalesce(p_state, ''))) ~ '^[A-Z]{2}$' then upper(btrim(p_state)) end;
  v_src   text := left(coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'pro'), 24);
  v_hdr   json;
  v_ip    text;
  v_iph   text;
begin
  -- honeypot: bots fill the hidden "website" field. Pretend it worked, store nothing.
  if coalesce(p_website, '') <> '' then return 'ok'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@.]{2,}$' then return 'invalid_email'; end if;
  if p_is_21 is not true then return 'age_required'; end if;

  -- keep only known answers (unknown values are dropped, not errors)
  select coalesce(array_agg(distinct f order by f), '{}') into v_feat from unnest(coalesce(p_features, '{}')) f
   where f = any (array['props_ev','alerts_25','tracker_pro','books_10','line_history','fast_refresh']);
  select coalesce(array_agg(distinct x order by x), '{}') into v_sport from unnest(coalesce(p_sports, '{}')) x
   where x = any (array['nfl','nba','mlb','nhl','ncaaf','ncaab','ufc']);

  select * into s from public.pro_waitlist_settings where id = 1;
  delete from public.pro_waitlist_log where at < now() - interval '2 days';

  -- rate limit per (hashed) client IP, plus a global daily brake
  begin v_hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then v_hdr := null; end;
  v_ip := coalesce(v_hdr->>'cf-connecting-ip', btrim(split_part(v_hdr->>'x-forwarded-for', ',', 1)), v_hdr->>'x-real-ip', 'unknown');
  v_iph := encode(sha256(convert_to(s.ip_salt || v_ip, 'UTF8')), 'hex');
  if (select count(*) from public.pro_waitlist_log where ip_hash = v_iph and at > now() - interval '1 hour') >= s.ip_hourly_cap then
    return 'rate_limited';
  end if;
  if (select count(*) from public.pro_waitlist_log where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= s.daily_cap then
    return 'busy';
  end if;
  insert into public.pro_waitlist_log (ip_hash) values (v_iph);

  select * into r from public.pro_waitlist where email = v_email;
  if r.id is null then
    insert into public.pro_waitlist (email, user_id, features, sports, price_choice, is_21, state, source)
    values (v_email, v_uid, v_feat, v_sport, v_price, true, v_state, v_src)
    on conflict (email) do nothing;               -- lost a race with an identical signup: fine, same answer
  elsif r.user_id is null or r.user_id = v_uid then
    -- dedupe: same email joins again -> update the answers on the one row (never a second row)
    update public.pro_waitlist
       set user_id = coalesce(v_uid, user_id), features = v_feat, sports = v_sport, price_choice = v_price,
           is_21 = true, state = coalesce(v_state, state), updated_at = now()
     where id = r.id;
  end if;                                         -- linked to a different account: leave it alone, same answer
  return 'ok';
end $$;

revoke all on function public.pro_waitlist_join(text, boolean, text[], text[], text, text, text, text) from public;
grant execute on function public.pro_waitlist_join(text, boolean, text[], text[], text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- Admin (SQL editor / service role only)
--   select count(*), count(user_id) as signed_in from public.pro_waitlist;
--   select unnest(features) f, count(*) from public.pro_waitlist group by 1 order by 2 desc;
--   select unnest(sports) s, count(*) from public.pro_waitlist group by 1 order by 2 desc;
--   select price_choice, count(*) from public.pro_waitlist group by 1 order by 2 desc;
--   select state, count(*) from public.pro_waitlist group by 1 order by 2 desc;
--   delete from public.pro_waitlist where email = lower('someone@example.com');   -- "remove me" requests
