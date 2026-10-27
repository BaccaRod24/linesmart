#!/usr/bin/env bash
# Exercises supabase/migrations/20261027_pro_waitlist.sql against a throwaway local Postgres with stand-ins for
# Supabase's auth schema and anon/authenticated roles (no network). Needs psql + a server you can create DBs on.
# Usage: PGHOST=/tmp/pgt PGPORT=55432 PGUSER=postgres bash scripts/pro_waitlist_sql_test.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
DB=${DB:-ls_pro_waitlist_test}
psql -qX -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P() { psql -qXtA -v ON_ERROR_STOP=1 -d $DB "$@"; }
P <<'SQL' >/dev/null
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase's default: new public tables are fully granted to anon/authenticated (the migration must revoke)
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users values ('11111111-1111-4111-8111-111111111111', 'fan1@example.com'),
                              ('22222222-2222-4222-8222-222222222222', 'fan2@example.com');
SQL
M() { P -f supabase/migrations/20261027_pro_waitlist.sql >/dev/null; }
M; M   # re-runnable

fails=0
check() { if [ "$2" == "$3" ]; then echo "PASS sql: $1"; else echo "FAIL sql: $1 (got '$2', want '$3')"; fails=$((fails+1)); fi; }
last() { grep -v -e '^CONTEXT' -e '^LINE' -e '^HINT' -e '^ *\^' | tail -n1; }
A() { P -c "set role anon; set request.headers = '{\"x-forwarded-for\": \"${IP:-1.2.3.4}\"}'; $1" 2>&1 | last; }
AS() { local uid=$1; shift; P -c "set role authenticated; set request.jwt.claim.sub = '$uid'; set request.headers = '{\"x-forwarded-for\": \"${IP:-1.2.3.4}\"}'; $1" 2>&1 | last; }
U1=11111111-1111-4111-8111-111111111111; U2=22222222-2222-4222-8222-222222222222
J="public.pro_waitlist_join"

check "honeypot filled -> ok, nothing stored" "$(A "select $J('bot@example.com', true, p_website => 'http://spam')")|$(P -c "select count(*) from public.pro_waitlist")" "ok|0"
check "bad email rejected" "$(A "select $J('not-an-email', true)")" "invalid_email"
check "21+ required" "$(A "select $J('b@example.com', false)")" "age_required"
check "21+ null rejected" "$(A "select $J('b@example.com', null)")" "age_required"
check "valid join -> ok" "$(IP=5.5.5.5 A "select $J('  Fan@Example.COM ', true, array['books_10','props_ev','hack'], array['nfl','ufc','xfl'], '9.99', 'fl', 'value')")" "ok"
check "stored lower-cased, answers filtered" "$(P -c "select email||'|'||features::text||'|'||sports::text||'|'||price_choice||'|'||is_21||'|'||state||'|'||source||'|'||coalesce(user_id::text,'-') from public.pro_waitlist")" "fan@example.com|{books_10,props_ev}|{nfl,ufc}|9.99|true|FL|value|-"
check "unknown price dropped" "$(IP=5.5.5.9 A "select $J('p@example.com', true, p_price => '0.99')")|$(P -c "select coalesce(price_choice,'null') from public.pro_waitlist where email='p@example.com'")" "ok|null"
check "bad state dropped" "$(IP=5.5.5.9 A "select $J('s@example.com', true, p_state => 'Florida')")|$(P -c "select coalesce(state,'null') from public.pro_waitlist where email='s@example.com'")" "ok|null"
check "same email again: same answer, one row, answers updated" "$(IP=5.5.5.6 A "select $J('fan@example.com', true, array['line_history'], array['nba'], '4.99')")|$(P -c "select count(*)||' '||min(features::text)||' '||min(sports::text)||' '||min(price_choice)||' '||min(state) from public.pro_waitlist where email='fan@example.com'")" "ok|1 {line_history} {nba} 4.99 FL"
check "anon can't read the list" "$(A "select count(*) from public.pro_waitlist" | grep -c 'permission denied' || true)" "1"
check "authenticated can't read the list" "$(AS $U1 "select count(*) from public.pro_waitlist" | grep -c 'permission denied' || true)" "1"
check "anon can't insert directly" "$(A "insert into public.pro_waitlist (email, is_21) values ('x@example.com', true)" | grep -c 'permission denied' || true)" "1"
check "anon can't update" "$(A "update public.pro_waitlist set price_choice = 'more'" | grep -c 'permission denied' || true)" "1"
check "anon can't delete" "$(A "delete from public.pro_waitlist" | grep -c 'permission denied' || true)" "1"
check "anon can't read settings (salt)" "$(A "select ip_salt from public.pro_waitlist_settings" | grep -c 'permission denied' || true)" "1"
check "anon can't read the attempt log" "$(A "select count(*) from public.pro_waitlist_log" | grep -c 'permission denied' || true)" "1"
check "RLS on, no policies" "$(P -c "select string_agg(relname||':'||relrowsecurity::text, ',' order by relname) from pg_class where relname like 'pro_waitlist%' and relkind='r'")|$(P -c "select count(*) from pg_policies where tablename like 'pro_waitlist%'")" "pro_waitlist:true,pro_waitlist_log:true,pro_waitlist_settings:true|0"
check "service role (owner) can read" "$(P -c "select count(*) from public.pro_waitlist")" "3"
# signed in: user_id comes from the JWT, never from the client
check "signed-in join links auth.uid()" "$(IP=6.6.6.1 AS $U1 "select $J('fan1@example.com', true, array['alerts_25'])")|$(P -c "select user_id from public.pro_waitlist where email='fan1@example.com'")" "ok|$U1"
check "signed-in rejoin of an anon entry links it" "$(IP=6.6.6.2 AS $U2 "select $J('fan@example.com', true, array['fast_refresh'])")|$(P -c "select user_id||' '||features::text from public.pro_waitlist where email='fan@example.com'")" "ok|$U2 {fast_refresh}"
check "anon can't change an account-linked entry (same answer)" "$(IP=6.6.6.3 A "select $J('fan1@example.com', true, array['books_10'])")|$(P -c "select features::text||' '||user_id from public.pro_waitlist where email='fan1@example.com'")" "ok|{alerts_25} $U1"
check "other account can't change it either" "$(IP=6.6.6.4 AS $U2 "select $J('fan1@example.com', true, array['books_10'])")|$(P -c "select features::text from public.pro_waitlist where email='fan1@example.com'")" "ok|{alerts_25}"
check "deleting the auth user keeps the entry, clears user_id" "$(P -c "delete from auth.users where id='$U1'; select coalesce(user_id::text,'null') from public.pro_waitlist where email='fan1@example.com'")" "null"
# per-IP rate limit: 5 attempts/hour
for i in 1 2 3 4 5; do IP=9.9.9.9 A "select $J('r$i@example.com', true)" >/dev/null; done
check "6th attempt from same IP in an hour -> rate_limited" "$(IP=9.9.9.9 A "select $J('r6@example.com', true)")|$(P -c "select count(*) from public.pro_waitlist where email='r6@example.com'")" "rate_limited|0"
check "other IPs unaffected" "$(IP=8.8.8.8 A "select $J('r7@example.com', true)")" "ok"
check "IP stored only as a hash" "$(P -c "select count(*) from public.pro_waitlist_log where ip_hash like '%9.9.9.9%'")" "0"
P -c "update public.pro_waitlist_log set at = now() - interval '3 days' where id = (select min(id) from public.pro_waitlist_log)"
IP=7.7.7.1 A "select $J('h@example.com', true)" >/dev/null
check "attempt log older than 2 days is purged" "$(P -c "select count(*) from public.pro_waitlist_log where at < now() - interval '2 days'")" "0"
# global daily brake
P -c "update public.pro_waitlist_settings set daily_cap = (select count(*) from public.pro_waitlist_log)"
check "daily cap -> busy, nothing stored" "$(IP=7.7.7.7 A "select $J('cap@example.com', true)")|$(P -c "select count(*) from public.pro_waitlist where email='cap@example.com'")" "busy|0"
check "table check: is_21 must be true" "$(P -c "insert into public.pro_waitlist (email, is_21) values ('z@example.com', false)" 2>&1 | grep -c 'violates check' || true)" "1"

psql -qX -d postgres -c "drop database $DB" >/dev/null
echo "$((fails)) failure(s)"; [ "$fails" -eq 0 ]
