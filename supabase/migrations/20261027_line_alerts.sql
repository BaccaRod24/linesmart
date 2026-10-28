-- LineSmart line alerts: signed-in users ask to be emailed when a game's line moves or reaches a number.
-- Run once in the Supabase dashboard SQL editor (project ctklbryattbbsqdmteny), AFTER 20261026_newsletter.sql
-- (it reuses the Vault secret 'newsletter_resend_key' and pg_net). Safe to re-run.
--
-- Design
--  * public.line_alerts has RLS: a signed-in user can select, insert and delete only their own rows (user_id =
--    auth.uid()). There is no update policy or grant, and inserts are limited to the user-settable columns, so a user
--    can't mark an alert sent, re-arm it, or touch anyone else's. A BEFORE INSERT trigger stamps user_id, enforces
--    10 active alerts per user and checks the game hasn't started.
--  * The checker runs in GitHub Actions after each odds refresh (no extra Odds API calls). It reads the active
--    alerts through line_alerts_pending(key) (no emails or user ids leave the database), compares them with the
--    already-published odds JSON, and reports matches to line_alerts_fire(key, hits) as numbers only.
--  * line_alerts_fire() re-checks every match against the alert's own rule, fires each alert once (status
--    active -> fired atomically, select ... for update), applies a per-user and a global daily cap, looks up the address in
--    auth.users, renders a fixed escaped template and sends it with pg_net -> Resend using the key already in Vault.
--    So the only new secret is a random check key (hash stored here); a leaked key can at most send these fixed
--    emails to alert owners, under the caps.
--  * Kill switch: line_alert_settings.enabled defaults to false; while false, line_alerts_fire() sends nothing.
--
-- After running this file, see the "Manual steps" block at the bottom.

create extension if not exists pg_net;

-- ---------------------------------------------------------------- tables
create table if not exists public.line_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  league        text not null check (league ~ '^[a-z0-9]{2,8}$'),
  game_id       text not null check (game_id ~ '^[0-9]{1,15}$'),
  kind          text not null check (kind in ('spread_move', 'total_move', 'spread_target', 'total_target', 'ml_target', 'prop_move')),
  side          text check (side in ('home', 'away', 'over', 'under')),
  books         text[] not null check (cardinality(books) between 1 and 3 and books <@ array['hardrockbet', 'draftkings', 'fanduel']),
  points        numeric check (points between 0.5 and 20 and points * 2 = trunc(points * 2)),   -- size of move, half points
  target        numeric check (target between -5000 and 5000),
  baseline      jsonb not null default '{}' check (jsonb_typeof(baseline) = 'object' and octet_length(baseline::text) <= 200),
  player_id     text check (player_id ~ '^[0-9]{1,15}$'),
  prop_market   text check (prop_market ~ '^[a-z_]{2,20}$'),
  game_label    text not null check (char_length(game_label) between 3 and 60 and game_label !~ '[<>[:cntrl:]]'),
  side_label    text check (char_length(side_label) <= 40 and side_label !~ '[<>[:cntrl:]]'),
  prop_label    text check (char_length(prop_label) <= 30 and prop_label !~ '[<>[:cntrl:]]'),
  starts_at     timestamptz not null,           -- game start; the alert expires then
  status        text not null default 'active' check (status in ('active', 'fired', 'expired')),
  created_at    timestamptz not null default now(),
  fired_at      timestamptz,
  fired_book    text,
  fired_value   numeric,
  fired_price   numeric,
  net_request_id bigint,
  constraint line_alerts_shape check (case kind
    when 'spread_move'   then side in ('home', 'away') and points is not null and baseline <> '{}'
    when 'total_move'    then side is null and points is not null and baseline <> '{}'
    when 'spread_target' then side in ('home', 'away') and target between -60 and 60 and target * 2 = trunc(target * 2)
    when 'total_target'  then side in ('over', 'under') and target > 0 and target <= 400 and target * 2 = trunc(target * 2)
    when 'ml_target'     then side in ('home', 'away') and abs(target) >= 100 and target = trunc(target)
    when 'prop_move'     then player_id is not null and prop_market is not null and points is not null and baseline <> '{}'
  end)
);
create index if not exists line_alerts_user_idx on public.line_alerts (user_id, status);
create index if not exists line_alerts_active_idx on public.line_alerts (starts_at) where status = 'active';

-- Every alert email sent (for the daily caps). Kept 3 days.
create table if not exists public.line_alert_sends (
  id       bigint generated always as identity primary key,
  user_id  uuid not null,
  alert_id uuid not null,
  at       timestamptz not null default now()
);
create index if not exists line_alert_sends_at_idx on public.line_alert_sends (at);

create table if not exists public.line_alert_settings (
  id              int primary key default 1 check (id = 1),
  enabled         boolean not null default false,  -- kill switch: nothing is sent while false
  site_url        text not null default 'https://linesmart.app',
  from_addr       text not null default 'LineSmart Alerts <no-reply@linesmart.app>',
  reply_to        text not null default 'contact@linesmart.app',
  max_active      int  not null default 10,        -- active alerts per user
  user_daily_cap  int  not null default 5,         -- alert emails per user per rolling 24 h
  global_daily_cap int not null default 40,        -- alert emails in total per rolling 24 h (Resend free plan = 100/day,
                                                   -- shared with sign-in codes and newsletter confirmations, also capped at 40)
  check_key_hash  text                             -- sha256 hex of the GitHub secret LINE_ALERTS_KEY
);
insert into public.line_alert_settings (id) values (1) on conflict (id) do nothing;

alter table public.line_alerts         enable row level security;
alter table public.line_alert_sends    enable row level security;
alter table public.line_alert_settings enable row level security;
-- Supabase grants everything on new public tables to anon/authenticated by default: take it all back, then grant
-- only what the policies below need.
revoke all on table public.line_alerts, public.line_alert_sends, public.line_alert_settings from anon, authenticated;
grant select, delete on table public.line_alerts to authenticated;
grant insert (league, game_id, kind, side, books, points, target, baseline, player_id, prop_market,
              game_label, side_label, prop_label, starts_at) on table public.line_alerts to authenticated;

drop policy if exists line_alerts_select_own on public.line_alerts;
drop policy if exists line_alerts_insert_own on public.line_alerts;
drop policy if exists line_alerts_delete_own on public.line_alerts;
create policy line_alerts_select_own on public.line_alerts for select to authenticated using (user_id = (select auth.uid()));
create policy line_alerts_insert_own on public.line_alerts for insert to authenticated with check (user_id = (select auth.uid()));
create policy line_alerts_delete_own on public.line_alerts for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- insert checks
create or replace function public.line_alerts_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_max int; v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.status := 'active'; new.created_at := now();
  new.fired_at := null; new.fired_book := null; new.fired_value := null; new.fired_price := null; new.net_request_id := null;
  if new.starts_at <= now() + interval '2 minutes' or new.starts_at > now() + interval '21 days' then
    raise exception 'alert_started' using errcode = '22023', hint = 'Alerts can only be set before the game starts.';
  end if;
  perform pg_advisory_xact_lock(hashtext('line_alerts:' || new.user_id::text));   -- two tabs can't both slip past the cap
  select max_active into v_max from public.line_alert_settings where id = 1;
  select count(*) into v_n from public.line_alerts where user_id = new.user_id and status = 'active' and starts_at > now();
  if v_n >= coalesce(v_max, 10) then
    raise exception 'alert_limit' using errcode = '22023', hint = 'Delete an alert to add another.';
  end if;
  return new;
end $$;
drop trigger if exists line_alerts_before_insert on public.line_alerts;
create trigger line_alerts_before_insert before insert on public.line_alerts
  for each row execute function public.line_alerts_before_insert();

-- ---------------------------------------------------------------- helpers
create or replace function public.line_alert_esc(t text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;
create or replace function public.line_alert_fmt(v numeric, how text) returns text
language sql immutable set search_path = '' as $$
  select case
    when v is null then ''
    when how = 'odds' then case when v > 0 then '+' else '-' end || abs(round(v))::text
    when how = 'spread' and v = 0 then 'PK'
    when how = 'spread' then case when v > 0 then '+' else '-' end || trim_scale(abs(v))::text
    else trim_scale(v)::text end
$$;
-- Same rule as AlertsCore.condition() in site/assets/alerts-core.js.
create or replace function public.line_alert_condition(a public.line_alerts, p_book text, p_value numeric)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare v_base numeric; d_cur numeric; d_tgt numeric;
begin
  if p_value is null or not (p_book = any (a.books)) then return false; end if;
  if a.kind in ('spread_move', 'total_move', 'prop_move') then
    if jsonb_typeof(a.baseline -> p_book) <> 'number' then return false; end if;
    v_base := (a.baseline ->> p_book)::numeric;
    return abs(p_value - v_base) >= a.points;
  elsif a.kind = 'spread_target' then return p_value >= a.target;
  elsif a.kind = 'total_target' then return case when a.side = 'over' then p_value <= a.target else p_value >= a.target end;
  elsif a.kind = 'ml_target' then
    if abs(p_value) < 100 then return false; end if;
    d_cur := case when p_value > 0 then 1 + p_value / 100 else 1 + 100 / -p_value end;
    d_tgt := case when a.target > 0 then 1 + a.target / 100 else 1 + 100 / -a.target end;
    return d_cur >= d_tgt - 0.000000001;
  end if;
  return false;
end $$;

-- 21+ helpline line for an alert email: {html, text}. Same numbers and order as the site (GeoCore.HELPLINES in
-- site/assets/geo-core.js; line_alerts_test.mjs checks they match). Known state with its own line -> that line first,
-- then 1-800-GAMBLER; other known states -> 1-800-GAMBLER; unknown (null) -> one compact multi-state line plus a link
-- to the site's helplines page. The state is not stored anywhere today, so alert emails use the unknown-state line.
create or replace function public.line_alert_helpline(p_state text, p_site text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  st constant text[] := array['FL', 'NY', 'AZ', 'IN', 'IA'];
  nm constant text[] := array['Florida', 'New York', 'Arizona', 'Indiana', 'Iowa'];
  ph constant text[] := array['1-833-PLAYWISE', '1-877-8-HOPENY', '1-800-NEXT-STEP', '1-800-9-WITH-IT', '1-800-BETS-OFF'];
  tl constant text[] := array['18337529947', '18778467369', '18006398783', '18009948448', '18002387633'];
  gam constant text := '<a href="tel:18004262537" style="color:inherit;text-decoration:underline">1-800-GAMBLER</a>';
  code text := case when p_state ~ '^[A-Za-z]{2}$' then upper(p_state) end;
  i int := array_position(st, code);
  rg text := coalesce(nullif(p_site, ''), 'https://linesmart.app') || '/responsible-gambling.html';
  h text := ''; t text := '';
  tel text;
begin
  if i is not null then
    tel := format('<a href="tel:%s" style="color:inherit;text-decoration:underline">%s</a>', tl[i], ph[i]);
    return jsonb_build_object(
      'html', format('21+ | Gambling problem? Call %s (%s) or %s.', tel, nm[i], gam),
      'text', format('21+ | Gambling problem? Call %s (%s) or 1-800-GAMBLER.', ph[i], nm[i]));
  end if;
  if code is not null then
    return jsonb_build_object('html', '21+ | Gambling problem? Call ' || gam || '.', 'text', '21+ | Gambling problem? Call 1-800-GAMBLER.');
  end if;
  for j in 1 .. cardinality(st) loop
    h := h || format('%s: <span style="white-space:nowrap"><a href="tel:%s" style="color:inherit;text-decoration:underline">%s</a></span> &middot; ', nm[j], tl[j], ph[j]);
    t := t || nm[j] || ': ' || ph[j] || ' · ';
  end loop;
  return jsonb_build_object(
    'html', '21+ | Gambling problem? ' || h || 'Elsewhere: <span style="white-space:nowrap">' || gam || '</span>. <a href="'
            || public.line_alert_esc(rg) || '" style="color:#22e1ff">All state helplines</a>',
    'text', '21+ | Gambling problem? ' || t || 'Elsewhere: 1-800-GAMBLER. All state helplines: ' || rg);
end $$;

-- The email for one fired alert: {subject, html, text}. Every user-supplied label is escaped; links are built here.
-- p_state: the recipient's state code if known (null today: no state is stored), for the helpline line.
-- (Before this took 4 arguments; drop that version so a re-run leaves one function.)
drop function if exists public.line_alert_email(public.line_alerts, text, numeric, numeric);
create or replace function public.line_alert_email(a public.line_alerts, p_book text, p_value numeric, p_price numeric, p_state text default null)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  s public.line_alert_settings;
  e text := '';
  bk text := case p_book when 'hardrockbet' then 'Hard Rock Bet' when 'draftkings' then 'DraftKings' when 'fanduel' then 'FanDuel' else p_book end;
  how text := case when a.kind in ('spread_move', 'spread_target') then 'spread' when a.kind = 'ml_target' then 'odds' else 'num' end;
  who text := coalesce(nullif(a.side_label, ''), '');
  base numeric := case when jsonb_typeof(a.baseline -> p_book) = 'number' then (a.baseline ->> p_book)::numeric end;
  cur text := public.line_alert_fmt(p_value, how);
  was text := public.line_alert_fmt(base, how);
  head text; rule text; link text; manage text; kick text; px text := ''; html text; txt text; rg jsonb;
begin
  select * into s from public.line_alert_settings where id = 1;
  rg := public.line_alert_helpline(p_state, s.site_url);
  head := case a.kind
    when 'spread_move'   then who || ' spread moved ' || was || ' to ' || cur || ' at ' || bk
    when 'total_move'    then 'Total moved ' || was || ' to ' || cur || ' at ' || bk
    when 'spread_target' then who || ' spread is ' || cur || ' at ' || bk
    when 'total_target'  then 'Total is ' || cur || ' at ' || bk
    when 'ml_target'     then who || ' moneyline is ' || cur || ' at ' || bk
    when 'prop_move'     then who || ' ' || coalesce(a.prop_label, a.prop_market) || ' line moved ' || was || ' to ' || cur || ' at ' || bk end;
  rule := case a.kind
    when 'spread_move'   then who || ' spread moves ' || trim_scale(a.points) || ' points'
    when 'total_move'    then 'total moves ' || trim_scale(a.points) || ' points'
    when 'spread_target' then who || ' spread reaches ' || public.line_alert_fmt(a.target, 'spread') || ' or better'
    when 'total_target'  then 'total reaches ' || initcap(a.side) || ' ' || trim_scale(a.target) || ' or better'
    when 'ml_target'     then who || ' moneyline reaches ' || public.line_alert_fmt(a.target, 'odds') || ' or better'
    when 'prop_move'     then who || ' ' || coalesce(a.prop_label, a.prop_market) || ' line moves ' || trim_scale(a.points) end;
  if p_price is not null and abs(p_price) >= 100 then
    px := case when a.kind = 'total_target' or a.kind = 'total_move' then initcap(coalesce(a.side, 'over')) || ' price ' else 'Price ' end || public.line_alert_fmt(p_price, 'odds');
  end if;
  link := s.site_url || '/#/g/' || a.league || '/' || a.game_id;
  manage := s.site_url || '/#/account';
  kick := to_char(a.starts_at at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET';

  html := format($h$<!doctype html><html><body style="margin:0;background:#050b1c;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#e8eeff">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#050b1c"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0c1630;border:1px solid #1f2d55;border-radius:16px">
<tr><td style="padding:28px 28px 6px;font-size:20px;font-weight:800;color:#e8eeff">Line<span style="color:#3d9bff">Smart</span> <span style="font-size:12px;font-weight:700;color:#22e1ff;letter-spacing:.06em;text-transform:uppercase">&nbsp;Line alert</span></td></tr>
<tr><td style="padding:10px 28px 0;font-size:13px;color:#7f90ba">%1$s &middot; %2$s</td></tr>
<tr><td style="padding:6px 28px 0;font-size:19px;line-height:1.4;font-weight:750;color:#e8eeff">%3$s</td></tr>
<tr><td style="padding:14px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%%;background:#091127;border:1px solid #1f2d55;border-radius:12px">
<tr><td style="padding:12px 14px;font-size:13px;color:#a3b3d9">Now at %4$s</td><td align="right" style="padding:12px 14px;font-size:22px;font-weight:800;color:#3ddc97;font-variant-numeric:tabular-nums">%5$s</td></tr>
%6$s%7$s</table></td></tr>
<tr><td style="padding:12px 28px 0;font-size:13px;line-height:1.6;color:#a3b3d9">Your alert: %8$s at %4$s. It's now off and won't email you again.</td></tr>
<tr><td style="padding:20px 28px"><a href="%9$s" style="display:inline-block;background:#3d9bff;color:#00132e;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px">See all lines for this game</a></td></tr>
<tr><td style="padding:0 28px 20px;font-size:12.5px;line-height:1.6;color:#7f90ba">Lines change often and may have moved again since this check. Check the sportsbook before you bet.</td></tr>
<tr><td style="padding:14px 28px 24px;border-top:1px solid #1f2d55;font-size:12px;line-height:1.7;color:#7f90ba"><a href="%10$s" style="color:#22e1ff">Manage or stop line alerts</a><br>%12$s<br>LineSmart is a free odds and stats site. We don't take bets. Questions: <a href="mailto:%11$s" style="color:#22e1ff">%11$s</a></td></tr>
</table></td></tr></table></body></html>$h$,
    public.line_alert_esc(a.game_label), public.line_alert_esc(kick), public.line_alert_esc(head), public.line_alert_esc(bk), public.line_alert_esc(cur),
    case when was <> '' and a.kind <> 'ml_target' then format('<tr><td style="padding:0 14px 10px;font-size:13px;color:#7f90ba">When you set the alert</td><td align="right" style="padding:0 14px 10px;font-size:14px;color:#a3b3d9">%s</td></tr>', public.line_alert_esc(was)) else '' end,
    case when px <> '' then format('<tr><td colspan="2" style="padding:0 14px 12px;font-size:13px;color:#7f90ba">%s</td></tr>', public.line_alert_esc(px)) else '' end,
    public.line_alert_esc(rule), public.line_alert_esc(link), public.line_alert_esc(manage), public.line_alert_esc(s.reply_to), rg ->> 'html');
  txt := 'LineSmart line alert' || chr(10) || chr(10) || head || chr(10) || a.game_label || ' - ' || kick || chr(10) ||
         case when px <> '' then px || chr(10) else '' end ||
         'Your alert: ' || rule || ' at ' || bk || '. It''s now off and won''t email you again.' || chr(10) || chr(10) ||
         'All lines for this game: ' || link || chr(10) ||
         'Lines change often and may have moved again since this check. Check the sportsbook before you bet.' || chr(10) || chr(10) ||
         'Manage or stop line alerts: ' || manage || chr(10) ||
         (rg ->> 'text') || chr(10) ||
         'LineSmart is a free odds and stats site. We don''t take bets. Questions: ' || s.reply_to;
  return jsonb_build_object('subject', left('Line alert: ' || head || ' (' || a.game_label || ')', 150), 'html', html, 'text', txt);
end $$;

create or replace function public.line_alerts_key_ok(p_key text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_hash text;
begin
  select check_key_hash into v_hash from public.line_alert_settings where id = 1;
  return v_hash is not null and p_key is not null and char_length(p_key) >= 32
     and encode(sha256(convert_to(p_key, 'UTF8')), 'hex') = v_hash;
end $$;

-- ---------------------------------------------------------------- for the GitHub Action (key-gated)
-- Active alerts to check: no user ids, no emails. Also expires alerts whose game has started and prunes old rows.
create or replace function public.line_alerts_pending(p_key text)
returns table (id uuid, league text, game_id text, kind text, side text, books text[], points numeric, target numeric,
               baseline jsonb, player_id text, prop_market text, starts_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.line_alerts_key_ok(p_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.line_alerts l set status = 'expired' where l.status = 'active' and l.starts_at <= now();
  delete from public.line_alerts l where l.status <> 'active' and coalesce(l.fired_at, l.starts_at) < now() - interval '30 days';
  delete from public.line_alert_sends x where x.at < now() - interval '3 days';
  return query select l.id, l.league, l.game_id, l.kind, l.side, l.books, l.points, l.target, l.baseline, l.player_id, l.prop_market, l.starts_at
    from public.line_alerts l where l.status = 'active' order by l.created_at limit 2000;
end $$;

-- Fire matched alerts. p_hits = [{"id": uuid, "book": "fanduel", "value": -2.5, "price": -110}, ...] (max 100).
-- Returns {"status": "ok"|"disabled"|"no_resend_key", "sent": n, "user_capped": n, "global_capped": n, "rejected": n, "gone": n}.
create or replace function public.line_alerts_fire(p_key text, p_hits jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.line_alert_settings;
  h jsonb; a public.line_alerts;
  v_key text; v_to text; v_val numeric; v_px numeric; v_mail jsonb; v_req bigint;
  sent int := 0; ucap int := 0; gcap int := 0; bad int := 0; gone int := 0; n_global int; n_user int;
begin
  if not public.line_alerts_key_ok(p_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.line_alert_settings where id = 1;
  if not s.enabled then return jsonb_build_object('status', 'disabled'); end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'newsletter_resend_key' limit 1;
  if v_key is null or v_key = '' then return jsonb_build_object('status', 'no_resend_key'); end if;
  if jsonb_typeof(p_hits) <> 'array' or jsonb_array_length(p_hits) > 100 then raise exception 'bad_hits' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('line_alerts_fire'));   -- one sender at a time, so the global cap holds
  select count(*) into n_global from public.line_alert_sends where at > now() - interval '24 hours';

  for h in select * from jsonb_array_elements(p_hits) loop
    if jsonb_typeof(h -> 'value') <> 'number' or coalesce(h ->> 'id', '') !~ '^[0-9a-f-]{36}$' then bad := bad + 1; continue; end if;
    select * into a from public.line_alerts l where l.id = (h ->> 'id')::uuid and l.status = 'active' and l.starts_at > now() for update;
    if a.id is null then gone := gone + 1; continue; end if;          -- deleted, already fired, or game started
    v_val := (h ->> 'value')::numeric;
    v_px := case when jsonb_typeof(h -> 'price') = 'number' and abs((h ->> 'price')::numeric) between 100 and 100000 then round((h ->> 'price')::numeric) end;
    if not public.line_alert_condition(a, h ->> 'book', v_val) then bad := bad + 1; continue; end if;
    if n_global >= s.global_daily_cap then gcap := gcap + 1; continue; end if;   -- stays active; may fire on a later run
    select count(*) into n_user from public.line_alert_sends where user_id = a.user_id and at > now() - interval '24 hours';
    if n_user >= s.user_daily_cap then ucap := ucap + 1; continue; end if;
    select u.email into v_to from auth.users u where u.id = a.user_id;
    if v_to is null or v_to = '' then gone := gone + 1; continue; end if;
    v_mail := public.line_alert_email(a, h ->> 'book', v_val, v_px, null);   -- state unknown: multi-state helpline line
    v_req := net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json',
                                    'Idempotency-Key', 'ls-alert-' || a.id::text),
      body    := jsonb_build_object('from', s.from_addr, 'to', jsonb_build_array(v_to), 'reply_to', s.reply_to,
                                    'subject', v_mail ->> 'subject', 'html', v_mail ->> 'html', 'text', v_mail ->> 'text',
                                    'tags', jsonb_build_array(jsonb_build_object('name', 'type', 'value', 'line-alert'))),
      timeout_milliseconds := 5000);
    update public.line_alerts set status = 'fired', fired_at = now(), fired_book = h ->> 'book', fired_value = v_val,
      fired_price = v_px, net_request_id = v_req where id = a.id;
    insert into public.line_alert_sends (user_id, alert_id) values (a.user_id, a.id);
    sent := sent + 1; n_global := n_global + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'sent', sent, 'user_capped', ucap, 'global_capped', gcap, 'rejected', bad, 'gone', gone);
end $$;

revoke all on function public.line_alerts_before_insert() from public, anon, authenticated;
revoke all on function public.line_alert_email(public.line_alerts, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.line_alert_helpline(text, text) from public, anon, authenticated;
revoke all on function public.line_alerts_key_ok(text) from public, anon, authenticated;
revoke all on function public.line_alerts_pending(text) from public;
revoke all on function public.line_alerts_fire(text, jsonb) from public;
grant execute on function public.line_alerts_pending(text) to anon, authenticated;
grant execute on function public.line_alerts_fire(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- Manual steps (run separately, with real values)
-- 1) Check key for the GitHub Action. Generate locally with:  openssl rand -hex 32
--    Save it as the GitHub secret LINE_ALERTS_KEY, then store only its hash here:
--      update public.line_alert_settings set check_key_hash = encode(sha256(convert_to('PASTE_THE_KEY', 'UTF8')), 'hex') where id = 1;
-- 2) Sending uses the Resend key already in Vault as 'newsletter_resend_key' (no new key needed).
-- 3) When the owner OKs real emails (after a dry run looks right):
--      update public.line_alert_settings set enabled = true where id = 1;
--    Turn off any time:  update public.line_alert_settings set enabled = false where id = 1;
-- 4) Optional checks:
--      select status, count(*) from public.line_alerts group by 1;
--      select count(*) from public.line_alert_sends where at > now() - interval '24 hours';
