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

## 4. Open Pro

Sign in with the LineSmart account from the statement above, then open `/owner.html`
(it is not linked, and it is `noindex`). The hash `#/owner` loads only after `is_pro()`
returns true. A flag in the browser does not turn it on.

Signing out, or any other account, leaves the normal free site.
