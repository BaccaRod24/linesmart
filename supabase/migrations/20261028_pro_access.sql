-- LineSmart Pro access: an owner-only switch. Run once in the Supabase SQL editor
-- (project ctklbryattbbsqdmteny) when Rod approves. Safe to re-run. Do not apply from CI.
--
-- This file does not insert any account. The owner row is a separate statement Rod runs
-- himself after he has signed in once (docs/pro-owner.md). No email address belongs in this file.
--
-- * public.pro_access is keyed by auth.users id. RLS is on. Authenticated clients may read
--   only their own row. There is no insert, update, or delete grant and no policy for those,
--   so a client cannot add itself, change a row, or read anyone else's row.
-- * public.is_pro() is SECURITY DEFINER and returns true only when auth.uid() is in the table.
--   Anon and signed-out calls are false. The browser cannot flip this.
-- * The Pro UI bundle is a private Storage object. Only is_pro() users can read it.
-- * Active line alerts: 25 for an is_pro() account, otherwise the free setting (10).
--   The email daily cap is not changed. This file does not send email.

-- ---------------------------------------------------------------- table
create table if not exists public.pro_access (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.pro_access enable row level security;

drop policy if exists pro_access_select_own on public.pro_access;
create policy pro_access_select_own on public.pro_access
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.pro_access from public, anon, authenticated;
grant select on table public.pro_access to authenticated;

-- ---------------------------------------------------------------- the only client check
create or replace function public.is_pro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pro_access a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_pro() from public;
grant execute on function public.is_pro() to anon, authenticated;

-- ---------------------------------------------------------------- private bundle
insert into storage.buckets (id, name, public)
values ('pro-private', 'pro-private', false)
on conflict (id) do update set public = false;

drop policy if exists pro_private_read on storage.objects;
create policy pro_private_read on storage.objects
  for select to authenticated
  using (bucket_id = 'pro-private' and public.is_pro());

-- ---------------------------------------------------------------- active alert cap (no email change)
-- Replaces line_alerts_before_insert from 20261027_line_alerts.sql. Same checks, except an
-- is_pro() account may keep 25 active alerts. line_alert_settings.user_daily_cap stays 5.
create or replace function public.line_alerts_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_max int; v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.status := 'active'; new.created_at := now();
  new.fired_at := null; new.fired_book := null; new.fired_value := null; new.fired_price := null; new.net_request_id := null;
  if new.starts_at <= now() + interval '2 minutes' or new.starts_at > now() + interval '21 days' then
    raise exception 'alert_started' using errcode = '22023', hint = 'Alerts can only be set before the game starts.';
  end if;
  perform pg_advisory_xact_lock(hashtext('line_alerts:' || new.user_id::text));
  select case when public.is_pro() then 25 else max_active end into v_max
    from public.line_alert_settings where id = 1;
  select count(*) into v_n from public.line_alerts where user_id = new.user_id and status = 'active' and starts_at > now();
  if v_n >= coalesce(v_max, 10) then
    raise exception 'alert_limit' using errcode = '22023', hint = 'Delete an alert to add another.';
  end if;
  return new;
end $$;
