# LineSmart Pro owner switch

Pro stays off for everyone until both of these are done. Do not run them from CI.

## 1. Migration

In the Supabase SQL editor, run `supabase/migrations/20261028_pro_access.sql` once.
That file creates `pro_access`, `is_pro()`, and the private `pro-private` bucket.
It does not insert an account and it does not contain an email address.

## 2. Owner row

Sign in once on the site (Account tab, email code or magic link) so the account exists.
Then run this one statement. It is the only place the owner email is written:

```sql
insert into public.pro_access (user_id) select id from auth.users where email = 'copenhaverrodney24@yahoo.com' on conflict (user_id) do nothing;
```

If that inserts nothing, the account has not signed in yet. Sign in, then run it again.

## 3. Publish the Pro bundle

GitHub Pages does not serve the Pro screens.

A merge to `main` packs `pro/dist/pro-app.js` and uploads it to bucket `pro-private`,
object name `pro-app.js`, with the Actions secret `SUPABASE_SERVICE_ROLE` (the same secret
as the rankings upload). The request sets `x-upsert` and cache control `0`. The secret is
never printed. The step runs on that merge, not on the 30-minute data refresh, and it
skips the upload when the packed source already matches the object in the bucket. A failed
upload is marked on the run and does not block the Pages deploy.

The site also requests the file with `cacheNonce` set to the deploy stamp plus the current
time, which is the query Storage's CDN treats as a new object. The `#/owner` hub shows
`Pro build … · site …`, and the console logs the same build id.

No client can upload the object. To replace it by hand, with `SUPABASE_SERVICE_ROLE` set in the environment:

```bash
node scripts/pack_pro_bundle.mjs
python3 scripts/upload_pro_bundle.py --file pro/dist/pro-app.js
```

Season rankings read `rankings.json` in the same private bucket, with the same signed-in request
as the bundle. The 30-minute refresh writes that file outside `site/` (`_private/rankings.json`,
gitignored) and uploads it when the Actions secret `SUPABASE_SERVICE_ROLE` is set. The upload
script skips, and does not fail the deploy, when the secret or the file is missing. The committed
`pro/rankings-data.js` is an empty shell on purpose: a real player snapshot in that file is
readable on the public GitHub repo even though GitHub Pages does not serve it. Do not commit
player rows there. The file is not published on GitHub Pages.

## 4. Open Pro

Sign in with the LineSmart account from the statement above, then open `/owner.html`
(it is not linked, and it is `noindex`). The hash `#/owner` is the Pro hub. It loads
only after `is_pro()` returns true. A flag in the browser does not turn it on.
The same hub opens at `#/pro` for that signed-in owner; everyone else still sees the waitlist there.
The hub lists today's biggest spread and total moves, sharp-flagged games, and a My Bets summary when this device has bets. The build stamp stays at the bottom.

The same check runs on the rest of the site, but only when this browser already has a
session. An access token that has expired is refreshed once, then `is_pro()` is tried
again. A browser flag still does not turn Pro on. When `is_pro()` is true, the private bundle adds Pro panels on game pages,
hot-prop filters on player props pages, a stats panel on My Bets, and a sharp-move badge
on the slate. Visitors and free accounts do not get those panels, and they do not download
the bundle. A failed or timed-out `is_pro()` call does not remove Pro for a session that
already verified. Signing out, or a definite `false`, does.

Signing out, or any other account, leaves the normal free site.
