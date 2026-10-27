#!/usr/bin/env bash
# Exercises supabase/migrations/20261026_newsletter.sql against a throwaway local Postgres with stand-ins for
# Supabase's anon role, Vault and pg_net (no network, nothing is sent). Needs psql + a server you can create DBs on.
# Usage: PGHOST=/tmp/pgt PGPORT=55432 PGUSER=postgres bash scripts/newsletter_sql_test.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
DB=ls_newsletter_test
psql -qX -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P() { psql -qXtA -v ON_ERROR_STOP=1 -d $DB "$@"; }
P <<'SQL' >/dev/null
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
grant usage on schema vault to public;
create schema net; create table net.calls (url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint
  language sql as $f$ insert into net.calls values (url, headers, body); select 1::bigint $f$;
grant usage on schema public to anon, authenticated;
SQL
# pg_net isn't installed locally; the stub above stands in for it.
grep -v '^create extension if not exists pg_net' supabase/migrations/20261026_newsletter.sql | P >/dev/null
grep -v '^create extension if not exists pg_net' supabase/migrations/20261026_newsletter.sql | P >/dev/null   # re-runnable

fails=0
check() { if [ "$2" == "$3" ]; then echo "PASS sql: $1"; else echo "FAIL sql: $1 (got '$2', want '$3')"; fails=$((fails+1)); fi; }
A() { P -c "set role anon; set request.headers = '{\"x-forwarded-for\": \"${IP:-1.2.3.4}\"}'; $1" | tail -n1; }

check "no Resend key yet -> unavailable" "$(A "select public.newsletter_subscribe('a@example.com', true)")" "unavailable"
P -c "insert into vault.decrypted_secrets values ('newsletter_resend_key', 're_test_key')"
check "honeypot filled -> ok, nothing stored" "$(A "select public.newsletter_subscribe('bot@example.com', true, 'http://spam')")" "ok"
check "bad email rejected" "$(A "select public.newsletter_subscribe('not-an-email', true)")" "invalid_email"
check "21+ required" "$(A "select public.newsletter_subscribe('b@example.com', false)")" "age_required"
check "valid signup -> ok" "$(IP=5.5.5.5 A "select public.newsletter_subscribe('  Fan@Example.COM ', true, '', 'home')")" "ok"
check "stored lower-cased, pending" "$(P -c "select email||'|'||status||'|'||source||'|'||confirm_sends from public.newsletter_subscribers")" "fan@example.com|pending|home|1"
check "honeypot row not stored" "$(P -c "select count(*) from public.newsletter_subscribers where email like 'bot%'")" "0"
check "one confirmation email queued to Resend" "$(P -c "select count(*)||' '||min(url)||' '||min(body->>'to') from net.calls")" '1 https://api.resend.com/emails ["fan@example.com"]'
check "confirm link in email" "$(P -c "select (min(body->>'html') like '%/subscribed.html?t=' || (select confirm_token from public.newsletter_subscribers) || '%')::text from net.calls")" "true"
check "key not in email body" "$(P -c "select (min(body::text) like '%re_test_key%')::text from net.calls")" "false"
check "repeat signup within 10 min: same answer, no 2nd email" "$(IP=5.5.5.6 A "select public.newsletter_subscribe('fan@example.com', true)")|$(P -c "select count(*) from net.calls")" "ok|1"
check "anon can't read subscribers" "$(A "select count(*) from public.newsletter_subscribers" 2>&1 | grep -c 'permission denied' || true)" "1"
check "anon can't insert directly" "$(A "insert into public.newsletter_subscribers (email, age_confirmed) values ('x@example.com', true)" 2>&1 | grep -c 'permission denied' || true)" "1"
check "anon can't call internal sender" "$(A "select public.newsletter_send_confirmation(1)" 2>&1 | grep -c 'permission denied' || true)" "1"
TOK=$(P -c "select confirm_token from public.newsletter_subscribers")
UNS=$(P -c "select unsub_token from public.newsletter_subscribers")
check "random token -> invalid" "$(A "select public.newsletter_confirm(gen_random_uuid())")" "invalid"
check "confirm" "$(A "select public.newsletter_confirm('$TOK')")" "confirmed"
check "confirm again -> already" "$(A "select public.newsletter_confirm('$TOK')")" "already"
check "confirmed address signs up again: ok, no email" "$(IP=5.5.5.7 A "select public.newsletter_subscribe('fan@example.com', true)")|$(P -c "select count(*) from net.calls")" "ok|1"
check "recipients refused without key" "$(A "select count(*) from public.newsletter_recipients('x')" 2>&1 | grep -c forbidden || true)" "1"
KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
P -c "update public.newsletter_settings set export_key_hash = encode(sha256(convert_to('$KEY', 'UTF8')), 'hex')"
check "recipients refused with wrong key" "$(A "select count(*) from public.newsletter_recipients('${KEY/0/1}')" 2>&1 | grep -c forbidden || true)" "1"
check "recipients with key -> confirmed list" "$(A "select email||' '||unsub_token from public.newsletter_recipients('$KEY')")" "fan@example.com $UNS"
check "unsubscribe" "$(A "select public.newsletter_unsubscribe('$UNS')")" "unsubscribed"
check "unsubscribe again -> already" "$(A "select public.newsletter_unsubscribe('$UNS')")" "already"
check "unsubscribed not exported" "$(A "select count(*) from public.newsletter_recipients('$KEY')")" "0"
check "old confirm link can't resubscribe" "$(A "select public.newsletter_confirm('$TOK')")" "invalid"
check "re-signup after unsubscribe -> new double opt-in" "$(IP=5.5.5.8 A "select public.newsletter_subscribe('fan@example.com', true)")|$(P -c "select status||' '||(confirm_token<>'$TOK') from public.newsletter_subscribers")|$(P -c "select count(*) from net.calls")" "ok|pending true|2"
# per-IP rate limit: 5 attempts/hour
for i in 1 2 3 4 5; do IP=9.9.9.9 A "select public.newsletter_subscribe('r$i@example.com', true)" >/dev/null; done
check "6th attempt from same IP in an hour -> rate_limited" "$(IP=9.9.9.9 A "select public.newsletter_subscribe('r6@example.com', true)")" "rate_limited"
check "other IPs unaffected" "$(IP=8.8.8.8 A "select public.newsletter_subscribe('r7@example.com', true)")" "ok"
check "IP stored only as a hash" "$(P -c "select count(*) from public.newsletter_signup_log where ip_hash like '%9.9.9.9%'")" "0"
# daily cap
P -c "update public.newsletter_settings set daily_confirm_cap = (select count(*) from public.newsletter_signup_log where sent)"
check "daily confirmation cap -> busy" "$(IP=7.7.7.7 A "select public.newsletter_subscribe('cap@example.com', true)")" "busy"
check "busy signup stores nothing" "$(P -c "select count(*) from public.newsletter_subscribers where email = 'cap@example.com'")" "0"
# expiry
P -c "update public.newsletter_subscribers set confirm_sent_at = now() - interval '15 days' where email = 'r7@example.com'"
check "confirm link older than 14 days -> expired" "$(A "select public.newsletter_confirm((select confirm_token from public.newsletter_subscribers where email = 'r7@example.com'))" 2>/dev/null || P -c "select public.newsletter_confirm((select confirm_token from public.newsletter_subscribers where email = 'r7@example.com'))")" "expired"
check "admin resend of never-sent pending rows" "$(P -c "insert into public.newsletter_subscribers (email, age_confirmed) values ('late@example.com', true); select public.newsletter_resend_pending()")" "1"

psql -qX -d postgres -c "drop database $DB" >/dev/null
echo "$((fails)) failure(s)"; [ "$fails" -eq 0 ]
