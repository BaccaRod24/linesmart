-- Daily new-account counts by entry point.
-- Paste this into the Supabase SQL editor after running
-- supabase/migrations/20261116_signup_entries.sql. Do not run it from the website.
-- It returns a day, a label, and a count. It does not return emails or user ids.
-- It does not write anything, and it does not touch pro_access.

select (created_at at time zone 'America/New_York')::date as day,
       entry,
       count(*)::int as signups
from public.signup_entries
group by 1, 2
order by 1 desc, 3 desc;

-- Waitlist joins by day (interest only, not a payment). Counts only.
-- select (created_at at time zone 'America/New_York')::date as day,
--        coalesce(source, 'pro') as source,
--        count(*)::int as joins
-- from public.pro_waitlist
-- group by 1, 2
-- order by 1 desc, 3 desc;
