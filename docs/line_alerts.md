# Line alerts

Signed-in users can ask for one email when a game's line moves or reaches a number they pick.

## What users can set

| Alert | Rule |
|---|---|
| Spread moves N pts | The team's spread moves N or more (either way) from when the alert was set |
| Total moves N pts | Same, for the game total |
| Spread hits a number | The team's spread reaches the target or better (e.g. GB -2.5 fires at -2.5, -2, +1) |
| Total hits a number | Over: total at or below the target. Under: at or above |
| Moneyline hits a price | The price pays at least as much as the target (+180 fires at +185; -150 fires at -140) |
| Prop line moves N | A player prop line moves N or more at the chosen book (set from the props table) |

- Books: Hard Rock Bet, DraftKings or FanDuel, one or more ("any of"). The sheet only offers books that are legal in the user's state (LSGeo), so Florida users get Hard Rock Bet only.
- Each alert sends **one** email, then turns off. It expires at game start. Users can have up to 10 active alerts.
- Users manage and delete alerts in **Account → Line alerts**. "Delete your data" also removes them.
- Each email carries the line, the book, a link to the game, "Lines change often…", a manage/stop link, and a 21+ helpline line built by `public.line_alert_helpline` from the same numbers as `site/assets/geo-core.js`: for a recipient in a state with its own line, "21+ | Gambling problem? Call 1-833-PLAYWISE (Florida) or 1-800-GAMBLER." (1-800-GAMBLER alone for other known states); when the state is unknown, a compact list ("Florida: 1-833-PLAYWISE · New York: 1-877-8-HOPENY · … · Elsewhere: 1-800-GAMBLER") plus a link to /responsible-gambling.html. No state is stored for alerts today, so sent alerts use the list. Storing it would need a `state` column on `line_alerts` (or a value in auth user metadata) set by the site, a privacy-policy note, and passing it as the 5th argument of `line_alert_email` in `line_alerts_fire`.

## Design (and why)

```
refresh-and-deploy (cron */30) ──► publishes data/*.json
        │ workflow_run (success)
        ▼
line-alerts.yml (GitHub Actions, contents: read)
  1. line_alerts_pending(key)  ── active alerts, no emails or user ids
  2. compare with the published JSON  (alerts-core.js, the same code the browser uses)
  3. line_alerts_fire(key, hits)  ── numbers only
        ▼
Postgres (Supabase): re-checks every hit against the alert's own rule, fires each alert once (atomic status change),
applies caps, reads the address from auth.users, renders a fixed escaped template,
sends with pg_net → Resend using the Vault key `newsletter_resend_key`.
```

- **No extra Odds API calls.** The checker only reads JSON that the refresh already published, and it never sees ODDS_API_KEY.
- **No new email secret.** Resend is called from the database with the key already in Vault. RESEND_API_KEY isn't needed in GitHub.
- **Emails and user ids never leave the database.** The Action sees alert rules and numbers only.
- **A leaked check key is low-impact.** It can only trigger these fixed emails to alert owners, for alerts whose rule really matches, under the caps. The database stores only its sha256.
- **Users can't tamper.** RLS lets a user select, insert and delete only their own rows. Inserts are limited to user-set columns, and there's no update grant. A trigger stamps user_id and enforces the 10-alert cap and "game not started".
- **Stale data is refused.** If the site build is over 90 min old, the run stops. A league whose odds pull is over 6 h old is skipped.
- **Caps** (table `line_alert_settings`): 5 emails per user per day and 40 per day overall. Resend's free plan allows 100/day, shared with sign-in codes (Supabase SMTP) and newsletter confirmations (also capped at 40).
- **No change to the existing refresh workflow**, so it can't break or slow the deploy.
- Why not a Supabase cron or Edge Function? Either would need the odds data and a scheduler inside Supabase plus a new service-role or Resend secret. Reading the published JSON from Actions adds no new keys besides one hashed check key.

## Kill switches (both OFF by default)

1. **GitHub repo variable `ALERTS_ENABLED`**:
   - unset: the workflow doesn't run
   - `dry-run`: logs matches, sends nothing
   - `1`: send
   Manual runs (Actions → Line alerts → Run workflow) default to dry-run, and "send" falls back to dry-run unless the variable is `1`.
2. **Database `line_alert_settings.enabled`** (default false). While false, `line_alerts_fire` sends nothing, even with a valid key.

Note: `workflow_run` triggers only fire for workflow files on the default branch, so nothing runs until this branch is merged.

## Setup steps (owner)

1. Supabase dashboard → SQL editor: run `supabase/migrations/20261027_line_alerts.sql` (after `20261026_newsletter.sql`). It's safe to re-run.
2. Make a check key locally: `openssl rand -hex 32`.
   - Save it as the GitHub **secret** `LINE_ALERTS_KEY` (Settings → Secrets and variables → Actions).
   - In the SQL editor, store only its hash:
     `update public.line_alert_settings set check_key_hash = encode(sha256(convert_to('PASTE_THE_KEY','UTF8')),'hex') where id = 1;`
3. (Optional) If the site isn't at https://linesmart.app: `update public.line_alert_settings set site_url = '…' where id = 1;`
4. Merge, then set the GitHub **variable** `ALERTS_ENABLED` = `dry-run`. Check a few runs' logs (Actions → Line alerts).
5. When happy:
   - `update public.line_alert_settings set enabled = true where id = 1;`
   - set `ALERTS_ENABLED` = `1`.
6. To turn it off, do either one: delete or change `ALERTS_ENABLED`, or run `update public.line_alert_settings set enabled = false where id = 1;`

Until step 1 is done, the site shows "Line alerts aren't switched on yet" in Account, and saving an alert gives a friendly error.

Useful checks:
`select status, count(*) from public.line_alerts group by 1;`
`select count(*) from public.line_alert_sends where at > now() - interval '24 hours';`

## Tests

Run every suite with the Odds API key unset:

```
env -u ODDS_API_KEY node scripts/line_alerts_test.mjs        # rules, validation, FL filter, checker, workflow modes
PGHOST=… PGPORT=… PGUSER=postgres bash scripts/line_alerts_sql_test.sh   # RLS, caps, fire-once, email (local PG, pg_net stubbed)
env -u ODDS_API_KEY BASE=http://127.0.0.1:PORT/linesmart/ OUT=screenshots node scripts/alerts_e2e.mjs  # browser, Supabase mocked
```

Local dry run against the live site's JSON (no database, no email):
`node scripts/line_alerts.mjs --mode dry-run --alerts-file my_alerts.json`
