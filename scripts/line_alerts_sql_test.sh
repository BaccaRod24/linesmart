#!/usr/bin/env bash
# Exercises supabase/migrations/20261027_line_alerts.sql against a throwaway local Postgres with stand-ins for
# Supabase's auth schema, roles, Vault and pg_net (no network, nothing is sent). Needs psql + a server you can create DBs on.
# Usage: PGHOST=/tmp/pgt PGPORT=55432 PGUSER=postgres bash scripts/line_alerts_sql_test.sh
# Set KEEP_DB=1 to keep the database (scripts use it to render the sample email for screenshots).
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
DB=${DB:-ls_alerts_test}
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
create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
create schema net; create table net.calls (url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint
  language sql as $f$ insert into net.calls values (url, headers, body); select count(*) from net.calls $f$;
grant usage on schema public to anon, authenticated;
-- Supabase's default: new public tables are fully granted to anon/authenticated (the migration must revoke)
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users values ('11111111-1111-4111-8111-111111111111', 'fan1@example.com'),
                              ('22222222-2222-4222-8222-222222222222', 'fan2@example.com');
SQL
M() { grep -v '^create extension if not exists pg_net' supabase/migrations/20261027_line_alerts.sql | P >/dev/null; }
M; M   # re-runnable

fails=0
check() { if [ "$2" == "$3" ]; then echo "PASS sql: $1"; else echo "FAIL sql: $1 (got '$2', want '$3')"; fails=$((fails+1)); fi; }
U1=11111111-1111-4111-8111-111111111111; U2=22222222-2222-4222-8222-222222222222
last() { grep -v -e '^CONTEXT' -e '^LINE' -e '^HINT' -e '^ *\^' | tail -n1; }   # value or the ERROR line
AS() { local uid=$1; shift; P -c "set role authenticated; set request.jwt.claim.sub = '$uid'; $1" 2>&1 | last; }
ANON() { P -c "set role anon; $1" 2>&1 | last; }
COLS="league, game_id, kind, side, books, points, target, baseline, game_label, side_label, starts_at"
ins() { AS "$1" "insert into public.line_alerts ($COLS) values ($2) returning kind"; }
SOON="now() + interval '1 day'"

check "user inserts own spread target" "$(ins $U1 "'nfl','401','spread_target','home','{hardrockbet}',null,-2.5,'{\"hardrockbet\":-3.5}','DAL @ PHI','PHI',$SOON")" "spread_target"
check "user_id stamped from the session" "$(P -c "select user_id from public.line_alerts")" "$U1"
check "can't insert for someone else" "$(AS $U1 "insert into public.line_alerts (user_id, $COLS) values ('$U2','nfl','401','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,$SOON)" | grep -c 'permission denied' || true)" "1"
check "can't insert status=fired" "$(AS $U1 "insert into public.line_alerts (status, $COLS) values ('fired','nfl','401','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,$SOON)" | grep -c 'permission denied' || true)" "1"
check "anon can't read alerts" "$(ANON "select count(*) from public.line_alerts" | grep -c 'permission denied' || true)" "1"
check "anon can't insert" "$(ANON "insert into public.line_alerts ($COLS) values ('nfl','401','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,$SOON)" | grep -c 'permission denied' || true)" "1"
check "game already started -> alert_started" "$(ins $U1 "'nfl','402','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,now() - interval '1 minute'" | grep -c alert_started || true)" "1"
check "unknown book rejected" "$(ins $U1 "'nfl','402','total_move',null,'{betmgm}',1,null,'{\"betmgm\":44.5}','A @ B',null,$SOON" | grep -c 'violates check' || true)" "1"
check "html in a label rejected" "$(ins $U1 "'nfl','402','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','<b>x</b>',null,$SOON" | grep -c 'violates check' || true)" "1"
check "kind/shape mismatch rejected (ML target 50)" "$(ins $U1 "'nfl','402','ml_target','home','{fanduel}',null,50,'{}','A @ B','B',$SOON" | grep -c 'violates check' || true)" "1"
ins $U2 "'nba','501','total_move',null,'{draftkings,fanduel}',1.5,null,'{\"draftkings\":220.5,\"fanduel\":221}','GS @ LAL',null,$SOON" >/dev/null
check "RLS: user 1 sees only own" "$(AS $U1 "select count(*) from public.line_alerts")" "1"
check "RLS: user 2 sees only own" "$(AS $U2 "select string_agg(league, ',') from public.line_alerts")" "nba"
ID2=$(P -c "select id from public.line_alerts where league = 'nba'")
check "RLS: can't delete someone else's" "$(AS $U1 "with d as (delete from public.line_alerts where id = '$ID2' returning 1) select count(*) from d")" "0"
check "no update grant (can't re-arm or edit)" "$(AS $U2 "update public.line_alerts set target = 1 where id = '$ID2'" | grep -c 'permission denied' || true)" "1"
for i in 2 3 4 5 6 7 8 9 10; do ins $U1 "'nfl','40$i','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,$SOON" >/dev/null; done
check "10 active alerts allowed" "$(P -c "select count(*) from public.line_alerts where user_id = '$U1'")" "10"
check "11th -> alert_limit" "$(ins $U1 "'nfl','411','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,$SOON" | grep -c alert_limit || true)" "1"
check "delete own frees a slot" "$(AS $U1 "with d as (delete from public.line_alerts where game_id = '4010' returning 1) select count(*) from d")|$(ins $U1 "'nfl','411','total_move',null,'{fanduel}',1,null,'{\"fanduel\":44.5}','A @ B',null,$SOON")" "1|total_move"

# ---- checker RPCs
KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
check "pending without key hash -> forbidden" "$(ANON "select count(*) from public.line_alerts_pending('$KEY')" | grep -c forbidden || true)" "1"
P -c "update public.line_alert_settings set check_key_hash = encode(sha256(convert_to('$KEY', 'UTF8')), 'hex')"
check "pending with wrong key -> forbidden" "$(ANON "select count(*) from public.line_alerts_pending('${KEY/0/1}')" | grep -c forbidden || true)" "1"
check "pending with key: all active alerts" "$(ANON "select count(*) from public.line_alerts_pending('$KEY')")" "11"
check "pending returns no user ids or emails" "$(ANON "select (row_to_json(p)::text ~ '(user_id|example.com|$U1)')::text from public.line_alerts_pending('$KEY') p limit 1")" "false"
ID1=$(P -c "select id from public.line_alerts where game_id = '401'")
HIT="[{\"id\":\"$ID1\",\"book\":\"hardrockbet\",\"value\":-2.5,\"price\":-110}]"
check "fire while disabled -> disabled, nothing sent" "$(ANON "select public.line_alerts_fire('$KEY', '$HIT')->>'status'")|$(P -c "select count(*) from net.calls")" "disabled|0"
P -c "update public.line_alert_settings set enabled = true"
check "fire with no Resend key in Vault -> no_resend_key" "$(ANON "select public.line_alerts_fire('$KEY', '$HIT')->>'status'")" "no_resend_key"
P -c "insert into vault.decrypted_secrets values ('newsletter_resend_key', 're_test_key')"
check "fire with wrong key -> forbidden" "$(ANON "select public.line_alerts_fire('${KEY/0/1}', '$HIT')" | grep -c forbidden || true)" "1"
BAD="[{\"id\":\"$ID1\",\"book\":\"hardrockbet\",\"value\":-3,\"price\":-110}]"
check "value that doesn't meet the rule is rejected" "$(ANON "select public.line_alerts_fire('$KEY', '$BAD')->>'rejected'")|$(P -c "select count(*) from net.calls")" "1|0"
WB="[{\"id\":\"$ID1\",\"book\":\"fanduel\",\"value\":-2.5}]"
check "book not on the alert is rejected" "$(ANON "select public.line_alerts_fire('$KEY', '$WB')->>'rejected'")" "1"
check "matching hit sends one email" "$(ANON "select public.line_alerts_fire('$KEY', '$HIT')->>'sent'")|$(P -c "select count(*)||' '||min(url)||' '||min(body->>'to') from net.calls")" '1|1 https://api.resend.com/emails ["fan1@example.com"]'
check "alert marked fired with the line" "$(P -c "select status||' '||fired_book||' '||fired_value||' '||fired_price from public.line_alerts where id = '$ID1'")" "fired hardrockbet -2.5 -110"
check "fires once: second report is ignored" "$(ANON "select public.line_alerts_fire('$KEY', '$HIT')->>'gone'")|$(P -c "select count(*) from net.calls")" "1|1"
check "user sees it as fired" "$(AS $U1 "select status from public.line_alerts where id = '$ID1'")" "fired"
SUBJ=$(P -c "select body->>'subject' from net.calls limit 1")
check "subject" "$SUBJ" "Line alert: PHI spread is -2.5 at Hard Rock Bet (DAL @ PHI)"
H() { P -c "select (body->>'html' like '%$1%')::text from net.calls limit 1"; }
check "email has game link" "$(H 'https://linesmart.app/#/g/nfl/401')" "true"
check "email has manage/stop link" "$(H 'https://linesmart.app/#/account')" "true"
# helplines: no state is stored, so a sent alert carries the compact multi-state line + the helplines link
FALL='Florida: 1-833-PLAYWISE · New York: 1-877-8-HOPENY · Arizona: 1-800-NEXT-STEP · Indiana: 1-800-9-WITH-IT · Iowa: 1-800-BETS-OFF · Elsewhere: 1-800-GAMBLER'
check "sent email (state unknown): 21+ and multi-state helpline line (text)" "$(P -c "select (body->>'text' like '%21+ | Gambling problem? $FALL. All state helplines: https://linesmart.app/responsible-gambling.html%')::text from net.calls limit 1")" "true"
check "sent email (state unknown): helplines in HTML with tel: links + link" "$(P -c "select (regexp_replace(body->>'html', '<[^>]+>', '', 'g') like '%21+ | Gambling problem? ' || replace('$FALL', ' · ', ' &middot; ') || '. All state helplines%' and body->>'html' like '%href=\"tel:18337529947\"%' and body->>'html' like '%href=\"https://linesmart.app/responsible-gambling.html\"%')::text from net.calls limit 1")" "true"
EM() { P -c "select public.line_alert_email(l, 'hardrockbet', -2.5, -110, $1) ->> '$2' from public.line_alerts l where l.id = '$ID1'"; }
check "Florida recipient (text): 1-833-PLAYWISE first, then 1-800-GAMBLER" "$(EM "'FL'" text | grep -c '^21+ | Gambling problem? Call 1-833-PLAYWISE (Florida) or 1-800-GAMBLER.$' || true)" "1"
check "Florida recipient (HTML): PLAYWISE tel first, no multi-state list" "$(EM "'FL'" html | grep -c 'Gambling problem? Call <a href="tel:18337529947"[^>]*>1-833-PLAYWISE</a> (Florida) or <a href="tel:18004262537"' || true)|$(EM "'FL'" html | grep -c 'HOPENY' || true)" "1|0"
check "New York recipient: 1-877-8-HOPENY first, then 1-800-GAMBLER" "$(EM "'ny'" text | grep -c '^21+ | Gambling problem? Call 1-877-8-HOPENY (New York) or 1-800-GAMBLER.$' || true)|$(EM "'NY'" html | grep -c 'tel:18778467369.*tel:18004262537' || true)" "1|1"
check "other known state (NJ): 1-800-GAMBLER only" "$(EM "'NJ'" text | grep -c '^21+ | Gambling problem? Call 1-800-GAMBLER.$' || true)" "1"
check "unknown state (null) and junk -> multi-state line" "$(EM null text | grep -c "^21+ | Gambling problem? $FALL" || true)|$(EM "'<b>'" text | grep -c "^21+ | Gambling problem? $FALL" || true)" "1|1"
check "alert email keeps the rest of the footer" "$(EM "'FL'" text | grep -c -e '^Manage or stop line alerts: ' -e "^LineSmart is a free odds and stats site. We don't take bets." || true)" "2"
check "email shows price and setting-time line" "$(H 'Price -110')|$(H '-3.5')" "true|true"
check "Resend key not in body" "$(P -c "select (body::text like '%re_test_key%')::text from net.calls limit 1")" "false"
check "idempotency key per alert" "$(P -c "select headers->>'Idempotency-Key' from net.calls limit 1")" "ls-alert-$ID1"
check "no banned words in email" "$(P -c "select (body::text ~* '(\mlock\M|guarantee|can''t lose|free money|promo|bonus code)')::text from net.calls")" "false"
# escaping: insert directly as the owner with a quote/ampersand label (labels can't contain < or >)
P -c "set request.jwt.claim.sub = '$U2'; insert into public.line_alerts ($COLS) values ('nba','502','ml_target','away','{fanduel}',null,150,'{}','\"A&B\" @ C''s','O''K',$SOON)"
ID3=$(P -c "select id from public.line_alerts where game_id = '502'")
check "ML target fires at a better price" "$(ANON "select public.line_alerts_fire('$KEY', '[{\"id\":\"$ID3\",\"book\":\"fanduel\",\"value\":160}]')->>'sent'")" "1"
check "labels HTML-escaped" "$(P -c "select (body->>'html' like '%&quot;A&amp;B&quot; @ C&#39;s%')::text from net.calls where body->>'subject' like '%+160%'")" "true"
# daily caps
P -c "update public.line_alert_settings set user_daily_cap = 1"
ID4=$(P -c "select id from public.line_alerts where game_id = '402'")
check "per-user daily cap holds the alert (stays active)" "$(ANON "select public.line_alerts_fire('$KEY', '[{\"id\":\"$ID4\",\"book\":\"fanduel\",\"value\":46}]')->>'user_capped'")|$(P -c "select status from public.line_alerts where id = '$ID4'")" "1|active"
P -c "update public.line_alert_settings set user_daily_cap = 5, global_daily_cap = 2"
check "global daily cap" "$(ANON "select public.line_alerts_fire('$KEY', '[{\"id\":\"$ID4\",\"book\":\"fanduel\",\"value\":46}]')->>'global_capped'")|$(P -c "select count(*) from net.calls")" "1|2"
P -c "update public.line_alert_settings set global_daily_cap = 40"
check "move alert fires when moved enough" "$(ANON "select public.line_alerts_fire('$KEY', '[{\"id\":\"$ID4\",\"book\":\"fanduel\",\"value\":43.5,\"price\":-105}]')->>'sent'")" "1"
check "too many hits in one call refused" "$(ANON "select public.line_alerts_fire('$KEY', (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'book', 'fanduel', 'value', 1)) from generate_series(1, 101)))" | grep -c bad_hits || true)" "1"
# expiry
P -c "update public.line_alerts set starts_at = now() - interval '1 minute' where game_id = '403'"
check "pending expires started games" "$(ANON "select count(*) from public.line_alerts_pending('$KEY')")|$(P -c "select status from public.line_alerts where game_id = '403'")" "8|expired"
check "anon can't call the email renderer" "$(ANON "select public.line_alert_email(null, 'x', 1, 1)" | grep -c 'permission denied' || true)" "1"
check "anon can't call the helpline renderer" "$(ANON "select public.line_alert_helpline('FL', 'x')" | grep -c 'permission denied' || true)" "1"
check "one line_alert_email function after re-runs" "$(P -c "select count(*) from pg_proc where proname = 'line_alert_email'")" "1"
# 20261028_email_helpline_size.sql: the helpline line at full body size / normal contrast; text and numbers unchanged
TXT_BEFORE=$(P -c "select string_agg(public.line_alert_helpline(s, 'https://x')->>'text', '|') from unnest(array['FL','NY','TX',null]) s")
P -f supabase/migrations/20261028_email_helpline_size.sql >/dev/null; P -f supabase/migrations/20261028_email_helpline_size.sql >/dev/null
check "helpline html is 15px, normal contrast (FL, NY, TX, unknown)" "$(P -c "select string_agg((public.line_alert_helpline(s, 'https://x')->>'html' like '<span style=\"font-size:15px;line-height:1.5;color:#e8eeff;font-weight:700\">21+ | Gambling problem?%</span>')::text, ',') from unnest(array['FL','NY','TX',null]) s")" "true,true,true,true"
check "NY html still has HOPENY + GAMBLER" "$(P -c "select (public.line_alert_helpline('NY', 'x')->>'html') ~ '1-877-8-HOPENY.*1-800-GAMBLER'")" "t"
check "helpline text versions unchanged" "$(P -c "select string_agg(public.line_alert_helpline(s, 'https://x')->>'text', '|') from unnest(array['FL','NY','TX',null]) s")" "$TXT_BEFORE"
check "anon still can't call the helpline renderer" "$(ANON "select public.line_alert_helpline('FL', 'x')" | grep -c 'permission denied' || true)" "1"

[ -n "${KEEP_DB:-}" ] || psql -qX -d postgres -c "drop database $DB" >/dev/null
echo "$((fails)) failure(s)"; [ "$fails" -eq 0 ]
