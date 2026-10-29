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

GitHub Pages does not serve the Pro screens. Pack them and upload one file to the private bucket:

```bash
node scripts/pack_pro_bundle.mjs
```

Upload `pro/dist/pro-app.js` to bucket `pro-private`, object name `pro-app.js`
(Storage, not the SQL editor; the service role or the dashboard). No client can upload it.
Set the object's cache control to `0` when the dashboard asks. The site also requests the file
with `cacheNonce` set to the deploy stamp plus the current time, which is the query Storage's
CDN treats as a new object. The `#/owner` hub shows `Pro build … · site …`, and the console
logs the same build id.

## 4. Open Pro

Sign in with the LineSmart account from the statement above, then open `/owner.html`
(it is not linked, and it is `noindex`). The hash `#/owner` is the Pro hub. It loads
only after `is_pro()` returns true. A flag in the browser does not turn it on.

The same check runs on the rest of the site, but only when this browser already has a
session. An access token that has expired is refreshed once, then `is_pro()` is tried
again. A browser flag still does not turn Pro on. When `is_pro()` is true, the private bundle adds Pro panels on game pages,
hot-prop filters on player props pages, a stats panel on My Bets, and a sharp-move badge
on the slate. Visitors and free accounts do not get those panels, and they do not download
the bundle. A failed or timed-out `is_pro()` call does not remove Pro for a session that
already verified. Signing out, or a definite `false`, does.

Signing out, or any other account, leaves the normal free site.
