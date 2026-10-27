-- LineSmart weekly newsletter: subscribers, double opt-in, unsubscribe, rate limits.
-- Run once in the Supabase dashboard SQL editor (project ctklbryattbbsqdmteny). Safe to re-run.
--
-- Design
--  * public.newsletter_subscribers has RLS on and NO policies, and anon/authenticated have no table grants,
--    so the publishable key can't read, list, update or even insert rows directly. Every change goes through
--    the SECURITY DEFINER functions below, which validate input, rate-limit, and never reveal whether an
--    address is already on the list (a plain "anon may insert" policy would leak that through unique-key
--    errors and couldn't send the confirmation email or rate-limit).
--  * Double opt-in: newsletter_subscribe() stores a pending row and sends the confirmation email straight
--    from Postgres with pg_net -> Resend. The Resend key lives in Supabase Vault (never in the site or repo).
--  * The weekly sender (GitHub Actions) reads confirmed addresses through newsletter_recipients(key), which
--    checks a SHA-256 hash of a long random export key. No service-role key leaves Supabase.
--
-- After running this file, see the "Manual steps" block at the bottom.

create extension if not exists pg_net;          -- functions live in schema "net" on Supabase

-- ---------------------------------------------------------------- tables
create table if not exists public.newsletter_subscribers (
  id               bigint generated always as identity primary key,
  email            text not null unique check (char_length(email) between 6 and 254 and email = lower(email)),
  status           text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  age_confirmed    boolean not null check (age_confirmed),        -- ticked "I'm 21+" at signup
  source           text check (char_length(source) <= 24),          -- home / footer / bets
  confirm_token    uuid not null default gen_random_uuid() unique,
  unsub_token      uuid not null default gen_random_uuid() unique,
  created_at       timestamptz not null default now(),
  confirm_sent_at  timestamptz,
  confirm_sends    int not null default 0,
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists newsletter_subscribers_status_idx on public.newsletter_subscribers (status);

-- Signup attempts, for rate limiting only. IP addresses are stored as salted hashes, kept 2 days.
create table if not exists public.newsletter_signup_log (
  id        bigint generated always as identity primary key,
  ip_hash   text not null,
  sent      boolean not null default false,    -- a confirmation email was sent on this attempt
  at        timestamptz not null default now()
);
create index if not exists newsletter_signup_log_ip_idx on public.newsletter_signup_log (ip_hash, at);
create index if not exists newsletter_signup_log_at_idx on public.newsletter_signup_log (at);

-- One-row settings table.
create table if not exists public.newsletter_settings (
  id                 int primary key default 1 check (id = 1),
  site_url           text not null default 'https://linesmart.app',
  from_addr          text not null default 'LineSmart <no-reply@linesmart.app>',
  reply_to           text not null default 'contact@linesmart.app',
  ip_hourly_cap      int  not null default 5,    -- signup attempts per IP per hour
  daily_confirm_cap  int  not null default 40,   -- confirmation emails per UTC day (Resend free plan = 100/day,
                                                 -- shared with Supabase sign-in codes and the weekly send)
  export_key_hash    text,                       -- sha256 hex of the GitHub secret NEWSLETTER_EXPORT_KEY
  ip_salt            text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.newsletter_settings (id) values (1) on conflict (id) do nothing;

alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_signup_log  enable row level security;
alter table public.newsletter_settings    enable row level security;
-- No policies on purpose: nothing is readable or writable with the publishable key except via the functions.
revoke all on table public.newsletter_subscribers, public.newsletter_signup_log, public.newsletter_settings from anon, authenticated;

-- ---------------------------------------------------------------- confirmation email (internal)
create or replace function public.newsletter_send_confirmation(p_id bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  s public.newsletter_settings;
  r public.newsletter_subscribers;
  v_key  text;
  v_link text;
  v_html text;
  v_text text;
begin
  select * into s from public.newsletter_settings where id = 1;
  select * into r from public.newsletter_subscribers where id = p_id;
  if r.id is null or r.status <> 'pending' then return false; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'newsletter_resend_key' limit 1;
  if v_key is null or v_key = '' then return false; end if;   -- not set up yet: row stays pending, unsent

  v_link := s.site_url || '/subscribed.html?t=' || r.confirm_token::text;
  v_html := format($h$<!doctype html><html><body style="margin:0;background:#050b1c;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#e8eeff">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#050b1c"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0c1630;border:1px solid #1f2d55;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:800;color:#e8eeff">Line<span style="color:#3d9bff">Smart</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:16px;line-height:1.55;color:#e8eeff"><b>Confirm your weekly LineSmart email</b></td></tr>
<tr><td style="padding:8px 28px 0;font-size:14px;line-height:1.6;color:#a3b3d9">Tap the button to start getting the free weekly email: best lines across Hard Rock Bet, DraftKings and FanDuel, hot props and notable line moves. One email a week, unsubscribe anytime.</td></tr>
<tr><td style="padding:22px 28px"><a href="%1$s" style="display:inline-block;background:#3d9bff;color:#00132e;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px">Confirm my email</a></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12.5px;line-height:1.6;color:#7f90ba">If you didn't sign up, ignore this email and you won't be added. Link not working? Copy this into your browser:<br><a href="%1$s" style="color:#22e1ff;word-break:break-all">%1$s</a></td></tr>
<tr><td style="padding:14px 28px 24px;border-top:1px solid #1f2d55;font-size:12px;line-height:1.6;color:#7f90ba">21+ | Gambling problem? Call 1-800-GAMBLER<br>LineSmart is a free odds and stats site. We don't take bets. Questions: <a href="mailto:%2$s" style="color:#22e1ff">%2$s</a></td></tr>
</table></td></tr></table></body></html>$h$, v_link, s.reply_to);
  v_text := 'Confirm your weekly LineSmart email' || chr(10) || chr(10) ||
            'Open this link to start getting the free weekly email (best lines, hot props, line moves):' || chr(10) || v_link || chr(10) || chr(10) ||
            'If you didn''t sign up, ignore this email and you won''t be added.' || chr(10) || chr(10) ||
            '21+ | Gambling problem? Call 1-800-GAMBLER' || chr(10) || 'Questions: ' || s.reply_to;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json',
                                  'Idempotency-Key', 'ls-confirm-' || r.confirm_token::text || '-' || r.confirm_sends::text),
    body    := jsonb_build_object('from', s.from_addr, 'to', jsonb_build_array(r.email), 'reply_to', s.reply_to,
                                  'subject', 'Confirm your weekly LineSmart email', 'html', v_html, 'text', v_text,
                                  'tags', jsonb_build_array(jsonb_build_object('name', 'type', 'value', 'newsletter-confirm'))),
    timeout_milliseconds := 5000);
  update public.newsletter_subscribers
     set confirm_sent_at = now(), confirm_sends = confirm_sends + 1, updated_at = now()
   where id = p_id;
  return true;
end $$;

-- ---------------------------------------------------------------- public API (publishable key)
-- Returns one of: ok | invalid_email | age_required | rate_limited | busy | unavailable
create or replace function public.newsletter_subscribe(p_email text, p_age_ok boolean, p_website text default '', p_source text default 'site')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.newsletter_settings;
  r public.newsletter_subscribers;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hdr   json;
  v_ip    text;
  v_iph   text;
  v_key   boolean;
  v_log   bigint;
begin
  -- honeypot: bots fill the hidden "website" field. Pretend it worked, store nothing.
  if coalesce(p_website, '') <> '' then return 'ok'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@.]{2,}$' then return 'invalid_email'; end if;
  if p_age_ok is not true then return 'age_required'; end if;

  select * into s from public.newsletter_settings where id = 1;

  -- housekeeping: drop old attempt logs and never-confirmed signups
  delete from public.newsletter_signup_log where at < now() - interval '2 days';
  delete from public.newsletter_subscribers where status = 'pending' and created_at < now() - interval '30 days';

  -- rate limit per (hashed) client IP
  begin v_hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then v_hdr := null; end;
  v_ip := coalesce(v_hdr->>'cf-connecting-ip', btrim(split_part(v_hdr->>'x-forwarded-for', ',', 1)), v_hdr->>'x-real-ip', 'unknown');
  v_iph := encode(sha256(convert_to(s.ip_salt || v_ip, 'UTF8')), 'hex');
  if (select count(*) from public.newsletter_signup_log where ip_hash = v_iph and at > now() - interval '1 hour') >= s.ip_hourly_cap then
    return 'rate_limited';
  end if;
  insert into public.newsletter_signup_log (ip_hash) values (v_iph) returning id into v_log;

  select exists (select 1 from vault.decrypted_secrets where name = 'newsletter_resend_key') into v_key;
  if not v_key then return 'unavailable'; end if;

  select * into r from public.newsletter_subscribers where email = v_email;
  if r.id is not null and r.status = 'confirmed' then return 'ok'; end if;     -- already on the list: same answer, no email
  if r.id is not null and r.status = 'pending'
     and (r.confirm_sent_at > now() - interval '10 minutes' or r.confirm_sends >= 5) then
    return 'ok';                                                              -- recently sent: don't resend yet
  end if;

  -- global cap so signups can never use up the Resend daily quota shared with sign-in codes
  if (select count(*) from public.newsletter_signup_log where sent and at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= s.daily_confirm_cap then
    return 'busy';
  end if;

  if r.id is null then
    insert into public.newsletter_subscribers (email, age_confirmed, source)
    values (v_email, true, left(coalesce(nullif(p_source, ''), 'site'), 24))
    returning * into r;
  elsif r.status = 'unsubscribed' then
    update public.newsletter_subscribers
       set status = 'pending', confirm_token = gen_random_uuid(), confirm_sends = 0, confirm_sent_at = null,
           age_confirmed = true, source = left(coalesce(nullif(p_source, ''), 'site'), 24), updated_at = now()
     where id = r.id returning * into r;
  end if;

  if public.newsletter_send_confirmation(r.id) then
    update public.newsletter_signup_log set sent = true where id = v_log;
  end if;
  return 'ok';
end $$;

-- Returns: confirmed | already | expired | invalid
create or replace function public.newsletter_confirm(p_token uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.newsletter_subscribers;
begin
  select * into r from public.newsletter_subscribers where confirm_token = p_token;
  if r.id is null or r.status = 'unsubscribed' then return 'invalid'; end if;
  if r.status = 'confirmed' then return 'already'; end if;
  if coalesce(r.confirm_sent_at, r.created_at) < now() - interval '14 days' then return 'expired'; end if;
  update public.newsletter_subscribers set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = r.id;
  return 'confirmed';
end $$;

-- One click, no login. Returns: unsubscribed | already | invalid
create or replace function public.newsletter_unsubscribe(p_token uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.newsletter_subscribers;
begin
  select * into r from public.newsletter_subscribers where unsub_token = p_token;
  if r.id is null then return 'invalid'; end if;
  if r.status = 'unsubscribed' then return 'already'; end if;
  update public.newsletter_subscribers set status = 'unsubscribed', unsubscribed_at = now(), updated_at = now() where id = r.id;
  return 'unsubscribed';
end $$;

-- For the weekly GitHub Action only: confirmed addresses + their unsubscribe tokens, gated by the export key.
create or replace function public.newsletter_recipients(p_key text)
returns table (email text, unsub_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_hash text;
begin
  select export_key_hash into v_hash from public.newsletter_settings where id = 1;
  if v_hash is null or p_key is null or char_length(p_key) < 32
     or encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> v_hash then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select s.email, s.unsub_token from public.newsletter_subscribers s where s.status = 'confirmed' order by s.id;
end $$;

-- Admin (SQL editor only): send confirmations to pending rows that never got one (e.g. signed up before the key was set).
create or replace function public.newsletter_resend_pending(p_limit int default 20)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; n int := 0;
begin
  for v_id in select id from public.newsletter_subscribers where status = 'pending' and confirm_sent_at is null order by id limit least(p_limit, 50) loop
    if public.newsletter_send_confirmation(v_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function public.newsletter_send_confirmation(bigint) from public, anon, authenticated;
revoke all on function public.newsletter_resend_pending(int) from public, anon, authenticated;
revoke all on function public.newsletter_subscribe(text, boolean, text, text) from public;
revoke all on function public.newsletter_confirm(uuid) from public;
revoke all on function public.newsletter_unsubscribe(uuid) from public;
revoke all on function public.newsletter_recipients(text) from public;
grant execute on function public.newsletter_subscribe(text, boolean, text, text) to anon, authenticated;
grant execute on function public.newsletter_confirm(uuid) to anon, authenticated;
grant execute on function public.newsletter_unsubscribe(uuid) to anon, authenticated;
grant execute on function public.newsletter_recipients(text) to anon, authenticated;

-- ---------------------------------------------------------------- Manual steps (run separately, with real values)
-- 1) Resend key for confirmation emails (a "Sending access" key restricted to linesmart.app):
--      select vault.create_secret('re_XXXXXXXX', 'newsletter_resend_key', 'Resend key: LineSmart newsletter confirmations');
--    (to rotate later: select vault.update_secret((select id from vault.secrets where name = 'newsletter_resend_key'), 're_NEW');)
-- 2) Export key for the weekly GitHub Action. Generate locally with:  openssl rand -hex 32
--    Save it as the GitHub secret NEWSLETTER_EXPORT_KEY, then store only its hash here:
--      update public.newsletter_settings set export_key_hash = encode(sha256(convert_to('PASTE_THE_KEY', 'UTF8')), 'hex') where id = 1;
-- 3) Optional checks:
--      select status, count(*) from public.newsletter_subscribers group by 1;
--      select * from net._http_response order by created desc limit 5;   -- Resend replies to confirmation sends
