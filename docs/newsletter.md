# LineSmart weekly email

Free weekly email, sent Thursday mornings: best prices across Hard Rock Bet, DraftKings and FanDuel, hot props (4/5+ over), notable line moves, and a plug for the bet tracker. It is built only from the site's own published data (`/data/*.json`) and **never calls The Odds API**.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Signup boxes | `site/assets/news.js`, `news-core.js` (homepage intro, footer, My Bets) | Email + required "I'm 21 or older" checkbox, a honeypot field, and a client cooldown. Posts to a Supabase RPC with the publishable key. |
| Storage | `supabase/migrations/20261026_newsletter.sql` | Tables have RLS on and **no policies**, and every grant is revoked from anon/authenticated. Access is only through `security definer` RPCs: `newsletter_subscribe` (per-IP hourly cap + daily confirmation cap), `newsletter_confirm`, `newsletter_unsubscribe`, `newsletter_recipients` (needs the export key). Responses never reveal whether an address is already on the list. |
| Double opt-in | Same migration | Subscribing sends a confirmation email from Postgres (pg_net → Resend). The Resend key lives in Supabase Vault as `newsletter_resend_key`. |
| Pages | `site/subscribed.html` (confirm), `site/unsubscribe.html` (noindex) | `?t=<token>`. Unsubscribe is one click and needs no login. |
| Weekly send | `.github/workflows/newsletter.yml` → `scripts/newsletter.mjs` (+ `newsletter_lib.mjs`) | Runs Thursday at 13:00 UTC. **Dry run by default**: it renders HTML and text to an artifact. It sends only when the variable `NEWSLETTER_ENABLED=1` is set. It uses the Resend batch API (100 per call) with a per-recipient `List-Unsubscribe` header and idempotency keys. |

Send guards: the run refuses if the mailing address is empty, if there are more recipients than `maxRecipients` (80), if the issue has no content, or if the data is more than 36 hours old. A banned-word lint checks the template copy for lock, guaranteed, can't lose, free money, promo, bonus and similar words.

## One-time setup (Rod)

1. **Supabase SQL editor**: run `supabase/migrations/20261026_newsletter.sql`. It enables `pg_net`.
2. **Resend**: create a *Sending access* API key restricted to `linesmart.app`.
   - In the SQL editor: `select vault.create_secret('re_…', 'newsletter_resend_key', 'LineSmart newsletter confirmations');`
   - In GitHub → Settings → Secrets → Actions: `RESEND_API_KEY` (the same key, or a second one).
3. **Export key**: run `openssl rand -hex 32` and save the result as the GitHub secret `NEWSLETTER_EXPORT_KEY`. Then:
   `update public.newsletter_settings set export_key_hash = encode(sha256(convert_to('THE_KEY','UTF8')),'hex') where id = 1;`
4. **Mailing address** (CAN-SPAM): set the GitHub variable `NEWSLETTER_MAILING_ADDRESS`, or `mailingAddress` in `scripts/newsletter.config.json`. A PO box or registered-agent address works.
5. **Test**: Actions → Weekly newsletter → Run workflow, mode `test`, `test_to` = your address. This sends one "[TEST]" email.
6. **Go live**: set the GitHub variable `NEWSLETTER_ENABLED` = `1`.
7. Optional:
   - Supabase Auth email codes go out through the same Resend quota (100/day on the free plan). Keep an eye on it, or point Auth SMTP somewhere else.
   - Add an Edge Function for RFC 8058 `List-Unsubscribe-Post`. Gmail requires it only for senders over 5,000 a day.

## Local

```
env -u ODDS_API_KEY node scripts/newsletter.mjs --mode dry-run --out newsletter-out/preview.html   # live public data
env -u ODDS_API_KEY node scripts/newsletter.mjs --data-dir path/to/data                          # local snapshot
env -u ODDS_API_KEY node scripts/newsletter_test.mjs
PGHOST=… bash scripts/newsletter_sql_test.sh                                                     # needs a local Postgres
```

## Resend free plan (as of Oct 2026)

- 3,000 emails a month and 100 a day (UTC day), shared with confirmations and Supabase Auth mail
- 30-day log retention, up to 3 domains
- Batch API: 100 emails per call
- Broadcasts: free up to 1,000 contacts

When the list grows past about 80, upgrade the plan or move the weekly send to Resend Broadcasts.
