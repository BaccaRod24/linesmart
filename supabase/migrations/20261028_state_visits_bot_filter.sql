-- LineSmart visits-by-state: ignore crawlers, monitors, and prefetch/prerender.
-- Run once in the Supabase dashboard SQL editor (project ctklbryattbbsqdmteny) AFTER
-- supabase/migrations/20261028_state_visits.sql. Safe to re-run. Do not apply from CI.
--
-- The browser (assets/geo.js) already skips these. This replaces state_visit_bump so a client
-- that calls the RPC directly (curl, a monitor, an old cached page) is dropped too.
--
-- Privacy: the user agent and purpose headers are read only to decide yes or no. They are not
-- written to state_visits or any other table, and this function does not log them.
-- If request headers are missing (a SQL-editor call) or cannot be read, the bump still counts,
-- so a header-format change cannot zero out real visitors. A header set that matches a known
-- bot or a prefetch/prerender purpose returns false and does not increment.

create or replace function public.state_visit_bump(p_state text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  st      text := upper(btrim(coalesce(p_state, '')));
  cfg     public.state_visit_settings;
  d       date := (now() at time zone 'America/New_York')::date;
  raw     text := current_setting('request.headers', true);
  hdr     json;
  ua      text := '';
  purpose text := '';
begin
  if st not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR') then
    return false;
  end if;

  if raw is not null and btrim(raw) <> '' then
    begin
      hdr := raw::json;
    exception when others then
      hdr := null; -- unreadable metadata: fail open, do not store it
    end;
    if hdr is not null then
      ua := left(lower(coalesce(hdr->>'user-agent', '')), 512);
      purpose := lower(concat_ws(' ',
        hdr->>'sec-purpose', hdr->>'purpose', hdr->>'x-purpose', hdr->>'x-moz'));
      if purpose like '%prefetch%' or purpose like '%prerender%' or purpose like '%preview%' then
        return false;
      end if;
      -- Same pattern as GeoCore.BOT_UA_RE. Matched, never stored.
      if ua ~ $re$googlebot|adsbot-google|mediapartners-google|feedfetcher-google|storebot-google|google-inspectiontool|google-read-aloud|google-safety|apis-google|duplexweb-google|google favicon|bingbot|bingpreview|msnbot|adidxbot|duckduckbot|yandexbot|applebot|ahrefsbot|ahrefs|semrushbot|semrush|mj12bot|dotbot|rogerbot|petalbot|amazonbot|gptbot|chatgpt-user|oai-searchbot|searchbot|claudebot|claude-user|anthropic-ai|perplexitybot|perplexity-user|ccbot|ia_archiver|archive\.org_bot|facebot|facebookexternalhit|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|embedly|quora link preview|skypeuripreview|redditbot|pinterestbot|uptimerobot|pingdom|pingbot|statuscake|site24x7|betteruptime|better uptime|freshping|hetrix|checkly|datadog|newrelic|catchpoint|thousandeyes|alertsite|headlesschrome|headless|phantomjs|puppeteer|playwright|selenium|webdriver|cypress|nightwatch|slimerjs|electron|screaming frog|curl/|wget|python-requests|python-urllib|python/|aiohttp|httpx/|go-http-client|okhttp|libwww|scrapy|java/|apache-httpclient|node-fetch|undici|axios/|postman|insomnia|lighthouse|chrome-lighthouse|ptst/|gtmetrix|pagespeed|bytespider|baiduspider|yisouspider|sogou web spider|sogou spider|exabot|seznambot|qwantify|barkrowler|blexbot|seekport|zoominfobot|dataforseobot|serpstatbot|megaindex|linesmart/|cron-job\.org|spider|crawler|slurp|robot|(?:^|[^a-z0-9])(?:bots?|crawlers?|spiders?)(?:[^a-z0-9]|$)$re$ then
        return false;
      end if;
    end if;
  end if;

  select * into cfg from public.state_visit_settings where id = 1;
  if cfg.id is not null and not cfg.enabled then return false; end if;

  insert into public.state_visits as v (day, state, visits) values (d, st, 1)
  on conflict (day, state) do update
    set visits = v.visits + 1
    where v.visits < coalesce(cfg.daily_cap, 20000);
  return true;
end;
$fn$;

revoke all on function public.state_visit_bump(text) from public;
grant execute on function public.state_visit_bump(text) to anon, authenticated;
