#!/usr/bin/env bash
# Exercises supabase/migrations/20261028_state_visits.sql against a throwaway local Postgres with stand-ins for
# Supabase's anon/authenticated roles (no network). Needs psql + a server you can create DBs on.
# Usage: PGHOST=/tmp/pgt PGPORT=55432 PGUSER=postgres bash scripts/state_visits_sql_test.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
DB=${DB:-ls_state_visits_test}
psql -qX -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P() { psql -qXtA -v ON_ERROR_STOP=1 -d $DB "$@"; }
P <<'SQL' >/dev/null
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
-- Supabase's default: new public tables/functions are granted to anon/authenticated (the migration must revoke)
alter default privileges in schema public grant all on tables to anon, authenticated;
SQL
M() { P -f supabase/migrations/20261028_state_visits.sql >/dev/null; }
M; M   # re-runnable

fails=0
check() { if [ "$2" == "$3" ]; then echo "PASS sql: $1"; else echo "FAIL sql: $1 (got '$2', want '$3')"; fails=$((fails+1)); fi; }
last() { grep -v -e '^CONTEXT' -e '^LINE' -e '^HINT' -e '^ *\^' | tail -n1; }
A() { P -c "set role anon; $1" 2>&1 | last; }
B="public.state_visit_bump"
TODAY=$(P -c "select (now() at time zone 'America/New_York')::date")

check "valid state counted" "$(A "select $B('FL')")|$(P -c "select day||' '||state||' '||visits from public.state_visits")" "t|$TODAY FL 1"
check "lower case / spaces normalised" "$(A "select $B(' fl ')")|$(P -c "select visits from public.state_visits where state='FL'")" "t|2"
check "DC and PR accepted" "$(A "select $B('DC')")$(A "select $B('PR')")" "tt"
check "unknown code ignored" "$(A "select $B('ZZ')")$(A "select $B('Florida')")$(A "select $B(null)")$(A "select $B('')")|$(P -c "select count(*) from public.state_visits")" "ffff|3"
check "table holds only day/state/visits" "$(P -c "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='state_visits'")" "day,state,visits"
check "anon can't read counts" "$(A "select count(*) from public.state_visits" | grep -c 'permission denied' || true)" "1"
check "anon can't insert" "$(A "insert into public.state_visits values (current_date, 'TX', 999)" | grep -c 'permission denied' || true)" "1"
check "anon can't update" "$(A "update public.state_visits set visits = 0" | grep -c 'permission denied' || true)" "1"
check "anon can't delete" "$(A "delete from public.state_visits" | grep -c 'permission denied' || true)" "1"
check "anon can't change settings" "$(A "update public.state_visit_settings set enabled = false" | grep -c 'permission denied' || true)" "1"
check "authenticated can't read counts" "$(P -c "set role authenticated; select count(*) from public.state_visits" 2>&1 | grep -c 'permission denied' || true)" "1"
check "RLS on, no policies" "$(P -c "select string_agg(relname||':'||relrowsecurity::text, ',' order by relname) from pg_class where relname like 'state_visit%' and relkind='r'")|$(P -c "select count(*) from pg_policies where tablename like 'state_visit%'")" "state_visit_settings:true,state_visits:true|0"
check "function is security definer with fixed search_path" "$(P -c "select prosecdef::text||' '||array_to_string(proconfig, ',') from pg_proc where proname='state_visit_bump'")" "true search_path=public, pg_temp"
P -c "update public.state_visit_settings set daily_cap = 3" >/dev/null
for i in 1 2 3 4; do A "select $B('NY')" >/dev/null; A "select $B('FL')" >/dev/null; done
check "daily cap per state" "$(P -c "select visits from public.state_visits where state='NY'")|$(P -c "select visits from public.state_visits where state='FL'")" "3|3"
P -c "update public.state_visit_settings set enabled = false, daily_cap = 20000" >/dev/null
check "disabled -> not counted" "$(A "select $B('TX')")|$(P -c "select count(*) from public.state_visits where state='TX'")" "f|0"

psql -qX -d postgres -c "drop database if exists $DB" >/dev/null
if [ $fails -gt 0 ]; then echo "$fails failure(s)"; exit 1; fi
echo "all state_visits SQL checks passed"
