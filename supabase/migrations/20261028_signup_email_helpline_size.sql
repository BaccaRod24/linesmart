-- Newsletter sign-up confirmation (double opt-in) email: show the 21+ / helpline line at full body-text size (15px)
-- and normal contrast (#e8eeff, bold), matching the weekly newsletter and line-alert emails
-- (20261028_email_helpline_size.sql), instead of the 12px dim footer text. Redefines ONLY
-- public.newsletter_send_confirmation(bigint) from 20261026_newsletter.sql: same signature, security definer,
-- search_path, behavior, wording and links; the only change is that the helpline line in the HTML footer is wrapped
-- in one styled <span> (number kept on one line). The plain-text version is unchanged. The rest of the footer stays 12px.
-- Run in the Supabase SQL editor after 20261026_newsletter.sql. Safe to re-run.

create or replace function public.newsletter_send_confirmation(p_id bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  s public.newsletter_settings;
  r public.newsletter_subscribers;
  v_key  text;
  v_link text;
  v_html text;
  v_text text;
begin
  select * into s from public.newsletter_settings where id = 1;
  select * into r from public.newsletter_subscribers where id = p_id;
  if r.id is null or r.status <> 'pending' then return false; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'newsletter_resend_key' limit 1;
  if v_key is null or v_key = '' then return false; end if;   -- not set up yet: row stays pending, unsent

  v_link := s.site_url || '/subscribed.html?t=' || r.confirm_token::text;
  v_html := format($h$<!doctype html><html><body style="margin:0;background:#050b1c;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#e8eeff">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#050b1c"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0c1630;border:1px solid #1f2d55;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:800;color:#e8eeff">Line<span style="color:#3d9bff">Smart</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:16px;line-height:1.55;color:#e8eeff"><b>Confirm your weekly LineSmart email</b></td></tr>
<tr><td style="padding:8px 28px 0;font-size:14px;line-height:1.6;color:#a3b3d9">Tap the button to start getting the free weekly email: best lines across Hard Rock Bet, DraftKings and FanDuel, hot props and notable line moves. One email a week, unsubscribe anytime.</td></tr>
<tr><td style="padding:22px 28px"><a href="%1$s" style="display:inline-block;background:#3d9bff;color:#00132e;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px">Confirm my email</a></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12.5px;line-height:1.6;color:#7f90ba">If you didn't sign up, ignore this email and you won't be added. Link not working? Copy this into your browser:<br><a href="%1$s" style="color:#22e1ff;word-break:break-all">%1$s</a></td></tr>
<tr><td style="padding:14px 28px 24px;border-top:1px solid #1f2d55;font-size:12px;line-height:1.6;color:#7f90ba"><span style="font-size:15px;line-height:1.5;color:#e8eeff;font-weight:700">21+ | Gambling problem? Call <span style="white-space:nowrap">1-800-GAMBLER</span></span><br>LineSmart is a free odds and stats site. We don't take bets. Questions: <a href="mailto:%2$s" style="color:#22e1ff">%2$s</a></td></tr>
</table></td></tr></table></body></html>$h$, v_link, s.reply_to);
  v_text := 'Confirm your weekly LineSmart email' || chr(10) || chr(10) ||
            'Open this link to start getting the free weekly email (best lines, hot props, line moves):' || chr(10) || v_link || chr(10) || chr(10) ||
            'If you didn''t sign up, ignore this email and you won''t be added.' || chr(10) || chr(10) ||
            '21+ | Gambling problem? Call 1-800-GAMBLER' || chr(10) || 'Questions: ' || s.reply_to;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json',
                                  'Idempotency-Key', 'ls-confirm-' || r.confirm_token::text || '-' || r.confirm_sends::text),
    body    := jsonb_build_object('from', s.from_addr, 'to', jsonb_build_array(r.email), 'reply_to', s.reply_to,
                                  'subject', 'Confirm your weekly LineSmart email', 'html', v_html, 'text', v_text,
                                  'tags', jsonb_build_array(jsonb_build_object('name', 'type', 'value', 'newsletter-confirm'))),
    timeout_milliseconds := 5000);
  update public.newsletter_subscribers
     set confirm_sent_at = now(), confirm_sends = confirm_sends + 1, updated_at = now()
   where id = p_id;
  return true;
end $$;

revoke all on function public.newsletter_send_confirmation(bigint) from public, anon, authenticated;
