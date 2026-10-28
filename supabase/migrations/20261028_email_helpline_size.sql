-- Line-alert emails: show the 21+ / helpline line at full body-text size (15px) and normal contrast (#e8eeff), like
-- the site footer, instead of the 12px dim footer text it inherits. Redefines ONLY public.line_alert_helpline()
-- (from 20261027_line_alerts.sql): same numbers, wording and order; each html result is wrapped in one styled <span>.
-- The plain-text versions are unchanged. Run in the Supabase SQL editor after 20261027_line_alerts.sql. Safe to re-run.
-- (The newsletter confirm email in 20261026_newsletter.sql still has its 12px helpline line: see the PR notes.)

create or replace function public.line_alert_helpline(p_state text, p_site text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  st constant text[] := array['FL', 'NY', 'AZ', 'IN', 'IA'];
  nm constant text[] := array['Florida', 'New York', 'Arizona', 'Indiana', 'Iowa'];
  ph constant text[] := array['1-833-PLAYWISE', '1-877-8-HOPENY', '1-800-NEXT-STEP', '1-800-9-WITH-IT', '1-800-BETS-OFF'];
  tl constant text[] := array['18337529947', '18778467369', '18006398783', '18009948448', '18002387633'];
  gam constant text := '<a href="tel:18004262537" style="color:inherit;text-decoration:underline">1-800-GAMBLER</a>';
  code text := case when p_state ~ '^[A-Za-z]{2}$' then upper(p_state) end;
  i int := array_position(st, code);
  rg text := coalesce(nullif(p_site, ''), 'https://linesmart.app') || '/responsible-gambling.html';
  h text := ''; t text := '';
  tel text;
begin
  if i is not null then
    tel := format('<a href="tel:%s" style="color:inherit;text-decoration:underline">%s</a>', tl[i], ph[i]);
    return jsonb_build_object(
      'html', '<span style="font-size:15px;line-height:1.5;color:#e8eeff;font-weight:700">' || format('21+ | Gambling problem? Call %s (%s) or %s.', tel, nm[i], gam) || '</span>',
      'text', format('21+ | Gambling problem? Call %s (%s) or 1-800-GAMBLER.', ph[i], nm[i]));
  end if;
  if code is not null then
    return jsonb_build_object('html', '<span style="font-size:15px;line-height:1.5;color:#e8eeff;font-weight:700">' || '21+ | Gambling problem? Call ' || gam || '.</span>', 'text', '21+ | Gambling problem? Call 1-800-GAMBLER.');
  end if;
  for j in 1 .. cardinality(st) loop
    h := h || format('%s: <span style="white-space:nowrap"><a href="tel:%s" style="color:inherit;text-decoration:underline">%s</a></span> &middot; ', nm[j], tl[j], ph[j]);
    t := t || nm[j] || ': ' || ph[j] || ' · ';
  end loop;
  return jsonb_build_object(
    'html', '<span style="font-size:15px;line-height:1.5;color:#e8eeff;font-weight:700">' || '21+ | Gambling problem? ' || h || 'Elsewhere: <span style="white-space:nowrap">' || gam || '</span>. <a href="'
            || public.line_alert_esc(rg) || '" style="color:#22e1ff">All state helplines</a></span>',
    'text', '21+ | Gambling problem? ' || t || 'Elsewhere: 1-800-GAMBLER. All state helplines: ' || rg);
end $$;

revoke all on function public.line_alert_helpline(text, text) from public, anon, authenticated;
